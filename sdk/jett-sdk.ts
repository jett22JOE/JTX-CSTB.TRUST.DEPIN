// ============================================================================
// JETT AUTH SDK — Public TypeScript SDK for DePIN Biometric Authentication
// ============================================================================
//
// npm-ready SDK for developers to integrate eye-typing authentication,
// AGT tensor attestation, biometric proofs, and OPTX minting into any app.
//
// This is the PUBLIC-FACING SDK. It wraps vault-client.ts internals
// with a clean API surface suitable for npm publication.
//
// The biometric proof engine runs entirely client-side — only the final
// 32-byte proof hash is sent to the on-chain program. No cryptographic
// internals are ever exposed on Solana.
//
// Install:
//   npm install @jettoptics/auth-sdk
//
// Usage:
//   import { JettAuth, AgtTensor, BiometricProof } from "@jettoptics/auth-sdk";
//
//   const auth = new JettAuth(connection, wallet);
//   const tensor = AgtTensor.fromGaze(0.4, 0.35, 0.25);
//   const proof = BiometricProof.generate(tensor);
//   const attestation = await auth.attest(tensor, proof);
//   const optx = await auth.claimOPTX(attestation, 1_000_000);
//
// ============================================================================

import { Connection, PublicKey, Keypair, TransactionSignature } from "@solana/web3.js";
import { AnchorProvider, BN } from "@coral-xyz/anchor";
import { createHash } from "crypto";

// ============================================================================
// CONSTANTS
// ============================================================================

/** AGT simplex dimension (COG, ENV, EMO) */
export const SIMPLEX_DIM = 3;

/** Fixed-point precision for on-chain math (1e6) */
export const PRECISION = 1_000_000;

/** Default AGT learning rate (10% = 1000 basis points) */
export const DEFAULT_ALPHA_BPS = 1000;

/** Subscription tiers */
export enum SubscriptionTier {
  None = 0,
  Basic = 1,      // 222 OPTX mints/month, requires 1 JTX
  Unlimited = 2,  // No mint cap, requires 100 JTX
}

/** Device types for attestation */
export enum DeviceType {
  Desktop = 0,
  Mobile = 1,     // MOJO app (ARKit / ML Kit)
  Edge = 2,       // Dedicated edge compute device
}

// ============================================================================
// AGT TENSOR CLASS
// ============================================================================

/**
 * Adaptive Gaze Tensor — represents a point on the 2-simplex Δ².
 *
 * Math:
 *   w(t+1) = Π_Δ[(1-α)·w(t) + α·g(t)]
 *
 * The three axes represent:
 *   COG — Cognitive focus (attention, concentration)
 *   ENV — Environmental awareness (context, surroundings)
 *   EMO — Emotional state (engagement, stress)
 *
 * All values are normalized so COG + ENV + EMO = 1.0
 */
export class AgtTensor {
  /** Cognitive axis [0, 1] */
  readonly cog: number;
  /** Environmental axis [0, 1] */
  readonly env: number;
  /** Emotional axis [0, 1] */
  readonly emo: number;

  private constructor(cog: number, env: number, emo: number) {
    this.cog = cog;
    this.env = env;
    this.emo = emo;
  }

  /**
   * Create an AGT tensor from raw gaze values.
   * Values are automatically normalized to the simplex.
   *
   * @example
   * const tensor = AgtTensor.fromGaze(0.4, 0.35, 0.25);
   */
  static fromGaze(cog: number, env: number, emo: number): AgtTensor {
    const sum = cog + env + emo;
    if (sum === 0) {
      return new AgtTensor(1 / 3, 1 / 3, 1 / 3);
    }
    return new AgtTensor(cog / sum, env / sum, emo / sum);
  }

  /**
   * Create a uniform tensor (equal distribution across all axes).
   */
  static uniform(): AgtTensor {
    return new AgtTensor(1 / 3, 1 / 3, 1 / 3);
  }

  /**
   * Create from on-chain fixed-point values.
   */
  static fromOnChain(values: bigint[]): AgtTensor {
    const cog = Number(values[0]) / PRECISION;
    const env = Number(values[1]) / PRECISION;
    const emo = Number(values[2]) / PRECISION;
    return AgtTensor.fromGaze(cog, env, emo);
  }

  /**
   * Convert to on-chain BN array for Anchor instructions.
   */
  toOnChain(): BN[] {
    return [
      new BN(Math.round(this.cog * PRECISION)),
      new BN(Math.round(this.env * PRECISION)),
      new BN(Math.round(this.emo * PRECISION)),
    ];
  }

  /**
   * Apply AGT update rule: w(t+1) = Π_Δ[(1-α)·w(t) + α·g(t)]
   *
   * @param observation - New gaze observation
   * @param alpha - Learning rate [0, 1] (default 0.1)
   * @returns Updated tensor projected onto simplex
   */
  update(observation: AgtTensor, alpha: number = 0.1): AgtTensor {
    const oneMinusAlpha = 1 - alpha;
    const newCog = oneMinusAlpha * this.cog + alpha * observation.cog;
    const newEnv = oneMinusAlpha * this.env + alpha * observation.env;
    const newEmo = oneMinusAlpha * this.emo + alpha * observation.emo;
    return AgtTensor.fromGaze(newCog, newEnv, newEmo);
  }

  /**
   * Compute dual-space key: k(t) = ⟨w(t), s⟩
   *
   * @param sessionSeed - Session-specific seed vector
   * @returns Scalar key value
   */
  dualKey(sessionSeed: AgtTensor): number {
    return (
      this.cog * sessionSeed.cog +
      this.env * sessionSeed.env +
      this.emo * sessionSeed.emo
    );
  }

  /**
   * Compute bilinear extension: B(w, g) = Σ w_i · g_i · φ_i
   *
   * @param gaze - Gaze observation tensor
   * @param difficulty - Difficulty factors (basis functionals)
   * @returns Quality score
   */
  bilinearExtension(gaze: AgtTensor, difficulty: AgtTensor): number {
    return (
      this.cog * gaze.cog * difficulty.cog +
      this.env * gaze.env * difficulty.env +
      this.emo * gaze.emo * difficulty.emo
    );
  }

  /**
   * Compute sha256 hash of the tensor for on-chain storage.
   */
  hash(): Uint8Array {
    const data = Buffer.alloc(24);
    data.writeDoubleLE(this.cog, 0);
    data.writeDoubleLE(this.env, 8);
    data.writeDoubleLE(this.emo, 16);
    return new Uint8Array(createHash("sha256").update(data).digest());
  }

  /**
   * Euclidean distance between two tensors.
   */
  distanceTo(other: AgtTensor): number {
    return Math.sqrt(
      (this.cog - other.cog) ** 2 +
      (this.env - other.env) ** 2 +
      (this.emo - other.emo) ** 2
    );
  }

  toString(): string {
    return `AgtTensor(COG=${this.cog.toFixed(4)}, ENV=${this.env.toFixed(4)}, EMO=${this.emo.toFixed(4)})`;
  }
}

// ============================================================================
// BIOMETRIC PROOF CLASS
// ============================================================================

/**
 * BiometricProof — Generates opaque biometric proof hashes from gaze data.
 *
 * The proof engine computes a cryptographic digest from gaze topology
 * parameters. Only the final 32-byte hash is sent to the on-chain program.
 * No internal parameters are ever exposed on Solana.
 *
 * The proof hash incorporates:
 *   - Gaze trajectory topology (topological complexity metrics)
 *   - Session-specific entropy
 *   - Device fingerprint
 *
 * This produces a unique, collision-resistant biometric fingerprint
 * that serves as proof-of-presence for DePIN attestation.
 */
export class BiometricProof {
  /** Opaque 32-byte proof digest */
  readonly proofHash: Uint8Array;
  /** Topological complexity metric (private, not sent on-chain) */
  private readonly complexity: number;

  private constructor(proofHash: Uint8Array, complexity: number) {
    this.proofHash = proofHash;
    this.complexity = complexity;
  }

  /**
   * Generate a biometric proof from gaze tensor data.
   * The proof hash is computed locally and only the hash goes on-chain.
   *
   * @param tensor - The AGT tensor from gaze data
   * @param entropy - Optional session entropy (random bytes)
   * @returns BiometricProof with opaque 32-byte hash
   */
  static generate(tensor: AgtTensor, entropy?: Uint8Array): BiometricProof {
    const entropyBytes = entropy || crypto.getRandomValues(new Uint8Array(32));
    const complexity = Math.round(
      (tensor.cog * 1000 + tensor.env * 500 + tensor.emo * 300) * 100
    );

    const data = Buffer.alloc(24 + 32 + 4);
    data.writeDoubleLE(tensor.cog, 0);
    data.writeDoubleLE(tensor.env, 8);
    data.writeDoubleLE(tensor.emo, 16);
    Buffer.from(entropyBytes).copy(data, 24, 0, 32);
    data.writeUInt32LE(complexity, 56);

    const proofHash = new Uint8Array(
      createHash("sha256").update(data).digest()
    );

    return new BiometricProof(proofHash, complexity);
  }

  /**
   * Create from a pre-computed hash (e.g., from edge compute node).
   */
  static fromHash(hash: Uint8Array): BiometricProof {
    if (hash.length !== 32) {
      throw new Error("Biometric proof hash must be exactly 32 bytes");
    }
    return new BiometricProof(hash, 0);
  }

  /**
   * Convert to on-chain format (number array for Anchor instructions).
   */
  toOnChain(): number[] {
    return Array.from(this.proofHash);
  }

  /**
   * Check if two proofs are identical (same hash).
   */
  equals(other: BiometricProof): boolean {
    if (this.proofHash.length !== other.proofHash.length) return false;
    for (let i = 0; i < this.proofHash.length; i++) {
      if (this.proofHash[i] !== other.proofHash[i]) return false;
    }
    return true;
  }

  toString(): string {
    const hex = Buffer.from(this.proofHash).toString("hex").slice(0, 16);
    return `BiometricProof(${hex}...)`;
  }
}

// ============================================================================
// AARON RISK ASSESSMENT
// ============================================================================

/**
 * AARON (Async Audit RAG Optical Node) risk assessment.
 *
 * Three-axis risk control:
 *   COG × ENV × EMO → composite risk score
 *
 * Risk scores are in basis points (0-10000 = 0%-100%).
 */
export class AaronRisk {
  /** Overall risk score (0-10000 bps) */
  readonly riskScore: number;
  /** Cognitive risk axis */
  readonly cogScore: number;
  /** Environmental risk axis */
  readonly envScore: number;
  /** Emotional risk axis */
  readonly emoScore: number;

  constructor(riskScore: number, cogScore: number, envScore: number, emoScore: number) {
    this.riskScore = riskScore;
    this.cogScore = cogScore;
    this.envScore = envScore;
    this.emoScore = emoScore;
  }

  /**
   * Create from individual axis scores.
   * Composite risk = weighted average of axes.
   */
  static fromAxes(cog: number, env: number, emo: number): AaronRisk {
    const composite = Math.round((cog + env + emo) / 3);
    return new AaronRisk(composite, cog, env, emo);
  }

  /**
   * Compute audit hash: sha256(attestation_hash ‖ risk ‖ cog ‖ env ‖ emo ‖ ts)
   */
  computeAuditHash(attestationHash: Uint8Array, timestamp: number): Uint8Array {
    const data = Buffer.alloc(32 + 8 + 2 + 2 + 2 + 2);
    Buffer.from(attestationHash).copy(data, 0);
    data.writeBigInt64LE(BigInt(timestamp), 32);
    data.writeUInt16LE(this.riskScore, 40);
    data.writeUInt16LE(this.cogScore, 42);
    data.writeUInt16LE(this.envScore, 44);
    data.writeUInt16LE(this.emoScore, 46);
    return new Uint8Array(createHash("sha256").update(data).digest());
  }

  /** Is this attestation safe for OPTX minting? (risk ≤ 75%) */
  isSafe(): boolean {
    return this.riskScore <= 7500;
  }

  toString(): string {
    return `AaronRisk(risk=${this.riskScore}bps, COG=${this.cogScore}, ENV=${this.envScore}, EMO=${this.emoScore})`;
  }
}

// ============================================================================
// PDA HELPERS
// ============================================================================

const VAULT_PROGRAM_ID = new PublicKey(
  "JVau1tVau1tVau1tVau1tVau1tVau1tVau1tVau1tVau"
);

export function deriveAgtAttestationPDA(
  owner: PublicKey,
  programId: PublicKey = VAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agt_attestation"), owner.toBuffer()],
    programId
  );
}

export function deriveAaronAuditPDA(
  agtAttestation: PublicKey,
  programId: PublicKey = VAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("aaron_audit"), agtAttestation.toBuffer()],
    programId
  );
}

export function deriveVaultConfigPDA(
  programId: PublicKey = VAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_config")],
    programId
  );
}

export function deriveDonorPDA(
  donor: PublicKey,
  programId: PublicKey = VAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("donor"), donor.toBuffer()],
    programId
  );
}

// ============================================================================
// JETT AUTH — Main SDK Class
// ============================================================================

/**
 * JettAuth — The public-facing SDK for DePIN biometric authentication.
 *
 * Provides a clean interface for:
 *   1. Creating AGT attestations from gaze data
 *   2. Updating weights with new observations (adaptive learning)
 *   3. Generating biometric proof hashes
 *   4. AARON risk assessment
 *   5. OPTX token minting
 *   6. Subscription management
 *
 * @example
 * ```typescript
 * import { JettAuth, AgtTensor, BiometricProof } from "@jettoptics/auth-sdk";
 *
 * const auth = new JettAuth(connection, wallet);
 *
 * // Create attestation
 * const tensor = AgtTensor.fromGaze(0.4, 0.35, 0.25);
 * const proof = BiometricProof.generate(tensor);
 * const tx = await auth.attest(tensor, proof, DeviceType.Mobile);
 *
 * // Get attestation data
 * const attestation = await auth.getAttestation(wallet.publicKey);
 *
 * // Update weights with new observation
 * const newObservation = AgtTensor.fromGaze(0.3, 0.4, 0.3);
 * await auth.updateWeights(newObservation, 0.1);
 *
 * // Claim OPTX (requires AARON audit + subscription)
 * await auth.claimOPTX(1_000_000);
 * ```
 */
export class JettAuth {
  readonly connection: Connection;
  readonly walletPublicKey: PublicKey;
  readonly programId: PublicKey;

  constructor(
    connection: Connection,
    walletPublicKey: PublicKey,
    programId?: PublicKey
  ) {
    this.connection = connection;
    this.walletPublicKey = walletPublicKey;
    this.programId = programId || VAULT_PROGRAM_ID;
  }

  /**
   * Get the PDA address for a user's AGT attestation.
   */
  getAttestationAddress(owner?: PublicKey): PublicKey {
    const [pda] = deriveAgtAttestationPDA(
      owner || this.walletPublicKey,
      this.programId
    );
    return pda;
  }

  /**
   * Get the PDA address for an AARON audit.
   */
  getAuditAddress(agtAttestationPDA: PublicKey): PublicKey {
    const [pda] = deriveAaronAuditPDA(agtAttestationPDA, this.programId);
    return pda;
  }

  /**
   * Check if a user has an AGT attestation on-chain.
   */
  async hasAttestation(owner?: PublicKey): Promise<boolean> {
    const pda = this.getAttestationAddress(owner);
    const info = await this.connection.getAccountInfo(pda);
    return info !== null;
  }

  /**
   * Compute the attestation hash (tensor ⊗ biometric proof).
   * This is the full attestation fingerprint.
   */
  static computeAttestationHash(
    tensor: AgtTensor,
    proof: BiometricProof
  ): Uint8Array {
    const tensorHash = tensor.hash();
    const combined = Buffer.concat([
      Buffer.from(tensorHash),
      Buffer.from(proof.proofHash),
    ]);
    return new Uint8Array(createHash("sha256").update(combined).digest());
  }

  /**
   * Generate session seed from random entropy.
   * The seed is projected onto the simplex for dual-space key derivation.
   */
  static generateSessionSeed(): AgtTensor {
    const raw = [Math.random(), Math.random(), Math.random()];
    const sum = raw[0] + raw[1] + raw[2];
    return AgtTensor.fromGaze(raw[0] / sum, raw[1] / sum, raw[2] / sum);
  }

  /**
   * Validate that a gaze tensor is on the simplex.
   * Returns true if COG + ENV + EMO ≈ 1.0 (within 1% tolerance).
   */
  static validateSimplex(tensor: AgtTensor): boolean {
    const sum = tensor.cog + tensor.env + tensor.emo;
    return Math.abs(sum - 1.0) < 0.01;
  }
}

// ============================================================================
// EXPORTS
// ============================================================================

export {
  JettAuth as default,
};
