import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN, Idl } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Connection,
  Transaction,
  TransactionSignature,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";

// ============================================================================
// TYPES & INTERFACES
// ============================================================================

/** Gaze attestation data from JETT OPTICS AGT system */
export interface GazeData {
  /** SHA-256 hash of the AGT tensor (32 bytes) */
  tensorHash: Uint8Array;
  /** Gaze duration in centiseconds (min 222 = 2.22 seconds) */
  durationCs: number;
  /** Cognitive vector [3 values] */
  cogVector: [number, number, number];
  /** Emotional vector [3 values] */
  emoVector: [number, number, number];
  /** Environmental vector [3 values] */
  envVector: [number, number, number];
  /** Entropy generated from gaze patterns */
  gazeEntropy: bigint;
}

/** Opaque compute proof data (not CompuStable / $CSTB — caller-supplied hash attestation) */
export interface ComputeProof {
  /** SHA-256 hash of the compute proof (32 bytes) */
  proofHash: Uint8Array;
  /** Difficulty level (1=Easy, 2=Medium, 3=Hard, etc.) */
  difficulty: number;
  /** Device type (0=Unknown, 1=Mobile, 2=Laptop, 3=Desktop, 4=Server) */
  deviceType: number;
  /** Proof nonce */
  nonce: bigint;
  /** Entropy generated from compute */
  computeEntropy: bigint;
}

/** Device type enumeration */
export enum DeviceType {
  Unknown = 0,
  Mobile = 1,
  Laptop = 2,
  Desktop = 3,
  Server = 4,
}

/** Handshake status */
export interface HandshakeStatus {
  initiator: PublicKey;
  handshakeId: Uint8Array;
  initiatedAt: Date;
  expiresAt: Date;
  gazeVerified: boolean;
  gazeVerifiedAt: Date | null;
  computeVerified: boolean;
  computeVerifiedAt: Date | null;
  attestationComplete: boolean;
  gazeEntropy: bigint;
  computeEntropy: bigint;
  isExpired: boolean;
}

/** Protocol configuration */
export interface ProtocolConfigAccount {
  authority: PublicKey;
  jtxMint: PublicKey;
  /** Legacy layout field (on-chain name cstb_mint); unused for gating */
  cstbMint: PublicKey;
  optxMint: PublicKey;
  totalHandshakes: bigint;
  totalAttestations: bigint;
  totalOptxMinted: bigint;
  gazeThreshold: bigint;
  computeDifficultyMin: number;
  entropyPerAttestation: bigint;
  optxPerEntropy: bigint;
  bump: number;
}

/** User entropy account */
export interface UserEntropyAccount {
  owner: PublicKey;
  totalEntropy: bigint;
  entropyUsed: bigint;
  attestationCount: bigint;
  lastAttestation: Date | null;
  optxMintingAllowance: bigint;
  bump: number;
}

/** Attestation record */
export interface AttestationAccount {
  owner: PublicKey;
  handshakeId: Uint8Array;
  createdAt: Date;
  gazeTensorHash: Uint8Array;
  computeProofHash: Uint8Array;
  combinedHash: Uint8Array;
  combinedEntropy: bigint;
  optxMinted: bigint;
  difficultyLevel: number;
  deviceType: number;
  isValid: boolean;
  revokedAt: Date | null;
  bump: number;
}

/** Handshake account */
export interface HandshakeAccount {
  publicKey: PublicKey;
  initiator: PublicKey;
  handshakeId: Uint8Array;
  initiatedAt: Date;
  expiresAt: Date;
  gazeVerified: boolean;
  gazeVerifiedAt: Date | null;
  gazeTensorHash: Uint8Array;
  cogVector: [number, number, number];
  emoVector: [number, number, number];
  envVector: [number, number, number];
  gazeEntropy: bigint;
  computeVerified: boolean;
  computeVerifiedAt: Date | null;
  computeProofHash: Uint8Array;
  difficultyLevel: number;
  deviceType: number;
  proofNonce: bigint;
  computeEntropy: bigint;
  attestationComplete: boolean;
  bump: number;
}

// ============================================================================
// CONSTANTS
// ============================================================================

/** $JTX token mint on mainnet */
export const JTX_MINT_MAINNET = new PublicKey(
  "JTXGnx83s2QZ2MwYkRD1cBKrqQKSdG5oe8vSYW5Zjoe"
);

/**
 * Legacy on-chain layout mint slot (devnet).
 * @deprecated Not a product mint. Kept for initialize() account matching only.
 */
export const LEGACY_COMPUTE_MINT_DEVNET = new PublicKey(
  "4waAAfTjqf5LNpj2TC5zoeiAgegVwKWoy4WiJgjdBkVL"
);

/** @deprecated Use LEGACY_COMPUTE_MINT_DEVNET */
export const CSTB_MINT_DEVNET = LEGACY_COMPUTE_MINT_DEVNET;

/** Default gaze threshold in centiseconds (2.22 seconds = "jett capture") */
export const DEFAULT_GAZE_THRESHOLD = 222;

/** Default minimum compute difficulty */
export const DEFAULT_COMPUTE_DIFFICULTY_MIN = 1;

/** Default entropy per attestation */
export const DEFAULT_ENTROPY_PER_ATTESTATION = 1000;

/** Default OPTX per entropy (multiplied by 1000 for precision) */
export const DEFAULT_OPTX_PER_ENTROPY = 1000;

/** PoA trust program ID (devnet) */
export const PROGRAM_ID = new PublicKey(
  "79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF"
);

/** PoA trust program ID (mainnet) */
export const PROGRAM_ID_MAINNET = new PublicKey(
  "85sqs4upQiPrvk1NMuyfHVQoW1EGdgk8m2cQb7uMxXTF"
);

// ============================================================================
// PDA DERIVATION HELPERS
// ============================================================================

/**
 * Derive the protocol config PDA address
 */
export function getProtocolConfigPDA(programId: PublicKey = PROGRAM_ID): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    programId
  );
}

/**
 * Derive a user entropy PDA address
 */
export function getUserEntropyPDA(
  user: PublicKey,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user-entropy"), user.toBuffer()],
    programId
  );
}

/**
 * Derive a handshake PDA address
 */
export function getHandshakePDA(
  user: PublicKey,
  handshakeId: Uint8Array,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("handshake"), user.toBuffer(), Buffer.from(handshakeId)],
    programId
  );
}

/**
 * Derive an attestation PDA address
 */
export function getAttestationPDA(
  owner: PublicKey,
  handshakeId: Uint8Array,
  programId: PublicKey = PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("attestation"), owner.toBuffer(), Buffer.from(handshakeId)],
    programId
  );
}

/**
 * Generate a random 32-byte handshake ID
 */
export function generateHandshakeId(): Uint8Array {
  return Keypair.generate().publicKey.toBytes();
}

// ============================================================================
// TRUST CLIENT
// ============================================================================

/**
 * JTX OPTX Proof-of-Attention Trust Protocol Client
 *
 * Provides a high-level interface for interacting with the Trust Protocol
 * smart contract on Solana.
 */
export class TrustClient {
  private program: Program;
  private provider: AnchorProvider;
  private programId: PublicKey;

  /**
   * Create a new TrustClient instance
   * @param provider - Anchor provider with connection and wallet
   * @param programId - Optional custom program ID (uses default if not specified)
   */
  constructor(provider: AnchorProvider, programId: PublicKey = PROGRAM_ID) {
    this.provider = provider;
    this.programId = programId;
    // Note: In production, load the IDL from the deployed program
    // For now, we use a minimal structure that works with raw instructions
    this.program = null as unknown as Program;
  }

  /**
   * Initialize the protocol with token mints and configuration
   * @param authority - The authority keypair that will control the protocol
   * @param jtxMint - $JTX token mint address
   * @param cstbMint - Legacy compute-mint layout slot (unused for gating)
   * @param optxMint - $OPTX token mint address (Token-2022)
   * @param options - Optional configuration overrides
   */
  async initialize(
    authority: Keypair,
    jtxMint: PublicKey,
    cstbMint: PublicKey,
    optxMint: PublicKey,
    options?: {
      gazeThreshold?: number;
      computeDifficultyMin?: number;
      entropyPerAttestation?: number;
      optxPerEntropy?: number;
    }
  ): Promise<TransactionSignature> {
    const [configPDA] = getProtocolConfigPDA(this.programId);

    const gazeThreshold = options?.gazeThreshold ?? DEFAULT_GAZE_THRESHOLD;
    const computeDifficultyMin = options?.computeDifficultyMin ?? DEFAULT_COMPUTE_DIFFICULTY_MIN;
    const entropyPerAttestation = options?.entropyPerAttestation ?? DEFAULT_ENTROPY_PER_ATTESTATION;
    const optxPerEntropy = options?.optxPerEntropy ?? DEFAULT_OPTX_PER_ENTROPY;

    const tx = await this.program.methods
      .initialize(
        new BN(gazeThreshold),
        computeDifficultyMin,
        new BN(entropyPerAttestation),
        new BN(optxPerEntropy)
      )
      .accounts({
        authority: authority.publicKey,
        protocolConfig: configPDA,
        jtxMint: jtxMint,
        cstbMint: cstbMint,
        optxMint: optxMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    return tx;
  }

  /**
   * Create a UserEntropy account for a new user
   * @param user - The user's keypair
   */
  async createUserEntropy(user: Keypair): Promise<UserEntropyAccount> {
    const [userEntropyPDA] = getUserEntropyPDA(user.publicKey, this.programId);

    await this.program.methods
      .createUserEntropy()
      .accounts({
        user: user.publicKey,
        userEntropy: userEntropyPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    return this.getUserEntropy(user.publicKey);
  }

  /**
   * Initiate a new handshake for attestation
   * @param user - The user's keypair
   * @param handshakeId - Optional custom handshake ID (32 bytes), generates random if not provided
   */
  async initiateHandshake(
    user: Keypair,
    handshakeId?: Uint8Array
  ): Promise<HandshakeAccount> {
    const id = handshakeId ?? generateHandshakeId();
    const [handshakePDA] = getHandshakePDA(user.publicKey, id, this.programId);
    const [configPDA] = getProtocolConfigPDA(this.programId);

    await this.program.methods
      .initiateHandshake(Array.from(id))
      .accounts({
        user: user.publicKey,
        handshake: handshakePDA,
        protocolConfig: configPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    return this.getHandshake(handshakePDA);
  }

  /**
   * Submit gaze attestation data (AGT hash + vectors)
   * @param user - The user's keypair
   * @param handshake - The handshake PDA address
   * @param gazeData - The gaze attestation data
   */
  async submitGazeAttestation(
    user: Keypair,
    handshake: PublicKey,
    gazeData: GazeData
  ): Promise<TransactionSignature> {
    const [configPDA] = getProtocolConfigPDA(this.programId);

    const tx = await this.program.methods
      .submitGazeAttestation(
        Array.from(gazeData.tensorHash),
        gazeData.cogVector,
        gazeData.emoVector,
        gazeData.envVector,
        new BN(gazeData.durationCs),
        new BN(gazeData.gazeEntropy.toString())
      )
      .accounts({
        user: user.publicKey,
        handshake: handshake,
        protocolConfig: configPDA,
      })
      .signers([user])
      .rpc();

    return tx;
  }

  /**
   * Submit opaque compute proof data (hash + difficulty)
   * @param user - The user's keypair
   * @param handshake - The handshake PDA address
   * @param proof - The compute proof data
   */
  async submitComputeProof(
    user: Keypair,
    handshake: PublicKey,
    proof: ComputeProof
  ): Promise<TransactionSignature> {
    const [configPDA] = getProtocolConfigPDA(this.programId);

    const tx = await this.program.methods
      .submitComputeProof(
        Array.from(proof.proofHash),
        proof.difficulty,
        proof.deviceType,
        new BN(proof.nonce.toString()),
        new BN(proof.computeEntropy.toString())
      )
      .accounts({
        user: user.publicKey,
        handshake: handshake,
        protocolConfig: configPDA,
      })
      .signers([user])
      .rpc();

    return tx;
  }

  /**
   * Finalize attestation and create permanent record
   * @param user - The user's keypair
   * @param handshake - The handshake PDA address
   */
  async finalizeAttestation(
    user: Keypair,
    handshake: PublicKey
  ): Promise<AttestationAccount> {
    const handshakeAccount = await this.getHandshake(handshake);
    const [attestationPDA] = getAttestationPDA(
      user.publicKey,
      handshakeAccount.handshakeId,
      this.programId
    );
    const [userEntropyPDA] = getUserEntropyPDA(user.publicKey, this.programId);
    const [configPDA] = getProtocolConfigPDA(this.programId);

    await this.program.methods
      .finalizeAttestation()
      .accounts({
        user: user.publicKey,
        handshake: handshake,
        attestation: attestationPDA,
        userEntropy: userEntropyPDA,
        protocolConfig: configPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    return this.getAttestation(user.publicKey, handshakeAccount.handshakeId);
  }

  /**
   * Mint OPTX tokens based on accumulated entropy allowance
   * @param user - The user's keypair
   * @param amount - Amount of OPTX to mint
   */
  async mintOptx(user: Keypair, amount: bigint): Promise<TransactionSignature> {
    const [userEntropyPDA] = getUserEntropyPDA(user.publicKey, this.programId);
    const [configPDA] = getProtocolConfigPDA(this.programId);
    const config = await this.getProtocolConfig();

    // Get or create user's OPTX token account
    const userOptxAccount = getAssociatedTokenAddressSync(
      config.optxMint,
      user.publicKey,
      false,
      TOKEN_2022_PROGRAM_ID
    );

    const tx = await this.program.methods
      .mintOptx(new BN(amount.toString()))
      .accounts({
        user: user.publicKey,
        userEntropy: userEntropyPDA,
        protocolConfig: configPDA,
        optxMint: config.optxMint,
        userOptxAccount: userOptxAccount,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([user])
      .rpc();

    return tx;
  }

  /**
   * Verify if an attestation exists and is valid
   * @param owner - The attestation owner's public key
   * @param handshakeId - The handshake ID
   */
  async verifyAttestation(
    owner: PublicKey,
    handshakeId: Uint8Array
  ): Promise<boolean> {
    try {
      const attestation = await this.getAttestation(owner, handshakeId);
      return attestation.isValid && attestation.revokedAt === null;
    } catch {
      return false;
    }
  }

  /**
   * Revoke an attestation (owner or authority only)
   * @param authority - The authority or owner's keypair
   * @param owner - The attestation owner's public key
   * @param handshakeId - The handshake ID
   */
  async revokeAttestation(
    authority: Keypair,
    owner: PublicKey,
    handshakeId: Uint8Array
  ): Promise<TransactionSignature> {
    const [attestationPDA] = getAttestationPDA(owner, handshakeId, this.programId);
    const [configPDA] = getProtocolConfigPDA(this.programId);

    const tx = await this.program.methods
      .revokeAttestation()
      .accounts({
        authority: authority.publicKey,
        attestation: attestationPDA,
        protocolConfig: configPDA,
      })
      .signers([authority])
      .rpc();

    return tx;
  }

  /**
   * Close a handshake account and reclaim rent
   * @param user - The user's keypair
   * @param handshake - The handshake PDA address
   */
  async closeHandshake(
    user: Keypair,
    handshake: PublicKey
  ): Promise<TransactionSignature> {
    const tx = await this.program.methods
      .closeHandshake()
      .accounts({
        user: user.publicKey,
        handshake: handshake,
      })
      .signers([user])
      .rpc();

    return tx;
  }

  // ============================================================================
  // READ METHODS
  // ============================================================================

  /**
   * Get the protocol configuration
   */
  async getProtocolConfig(): Promise<ProtocolConfigAccount> {
    const [configPDA] = getProtocolConfigPDA(this.programId);
    const account = await this.program.account.protocolConfig.fetch(configPDA);
    return this.parseProtocolConfig(account);
  }

  /**
   * Get a user's entropy account
   * @param user - The user's public key
   */
  async getUserEntropy(user: PublicKey): Promise<UserEntropyAccount> {
    const [userEntropyPDA] = getUserEntropyPDA(user, this.programId);
    const account = await this.program.account.userEntropy.fetch(userEntropyPDA);
    return this.parseUserEntropy(account);
  }

  /**
   * Get a user's OPTX minting allowance
   * @param user - The user's public key
   */
  async getOptxMintingAllowance(user: PublicKey): Promise<bigint> {
    const entropy = await this.getUserEntropy(user);
    return entropy.optxMintingAllowance;
  }

  /**
   * Get a handshake account
   * @param handshake - The handshake PDA address
   */
  async getHandshake(handshake: PublicKey): Promise<HandshakeAccount> {
    const account = await this.program.account.handshake.fetch(handshake);
    return this.parseHandshake(account, handshake);
  }

  /**
   * Get handshake status including expiry check
   * @param handshake - The handshake PDA address
   */
  async getHandshakeStatus(handshake: PublicKey): Promise<HandshakeStatus> {
    const hs = await this.getHandshake(handshake);
    const now = new Date();

    return {
      initiator: hs.initiator,
      handshakeId: hs.handshakeId,
      initiatedAt: hs.initiatedAt,
      expiresAt: hs.expiresAt,
      gazeVerified: hs.gazeVerified,
      gazeVerifiedAt: hs.gazeVerifiedAt,
      computeVerified: hs.computeVerified,
      computeVerifiedAt: hs.computeVerifiedAt,
      attestationComplete: hs.attestationComplete,
      gazeEntropy: hs.gazeEntropy,
      computeEntropy: hs.computeEntropy,
      isExpired: now > hs.expiresAt,
    };
  }

  /**
   * Get an attestation account
   * @param owner - The owner's public key
   * @param handshakeId - The handshake ID
   */
  async getAttestation(
    owner: PublicKey,
    handshakeId: Uint8Array
  ): Promise<AttestationAccount> {
    const [attestationPDA] = getAttestationPDA(owner, handshakeId, this.programId);
    const account = await this.program.account.attestation.fetch(attestationPDA);
    return this.parseAttestation(account);
  }

  /**
   * Get all attestations for a user
   * Note: This requires a getProgramAccounts call which can be expensive
   * @param owner - The owner's public key
   */
  async getAttestationHistory(owner: PublicKey): Promise<AttestationAccount[]> {
    const accounts = await this.provider.connection.getProgramAccounts(
      this.programId,
      {
        filters: [
          // Filter by account discriminator for Attestation
          {
            memcmp: {
              offset: 0,
              bytes: "7mSvxv6tYmUq", // Base58 encoded discriminator
            },
          },
          // Filter by owner
          {
            memcmp: {
              offset: 8, // After discriminator
              bytes: owner.toBase58(),
            },
          },
        ],
      }
    );

    return accounts.map((acc) => {
      const decoded = this.program.coder.accounts.decode(
        "Attestation",
        acc.account.data
      );
      return this.parseAttestation(decoded);
    });
  }

  // ============================================================================
  // UTILITY METHODS
  // ============================================================================

  /**
   * Calculate expected OPTX allowance from entropy values
   * @param gazeEntropy - Entropy from gaze attestation
   * @param computeEntropy - Entropy from compute proof
   * @param difficulty - Compute difficulty level
   * @param optxPerEntropy - OPTX per entropy rate (from config)
   */
  calculateOptxAllowance(
    gazeEntropy: bigint,
    computeEntropy: bigint,
    difficulty: number,
    optxPerEntropy: bigint = BigInt(DEFAULT_OPTX_PER_ENTROPY)
  ): bigint {
    const combinedEntropy = gazeEntropy + computeEntropy;
    return (combinedEntropy * BigInt(difficulty) * optxPerEntropy) / 1000n;
  }

  /**
   * Get the program ID
   */
  getProgramId(): PublicKey {
    return this.programId;
  }

  /**
   * Get the provider
   */
  getProvider(): AnchorProvider {
    return this.provider;
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  private parseProtocolConfig(account: any): ProtocolConfigAccount {
    return {
      authority: account.authority,
      jtxMint: account.jtxMint,
      cstbMint: account.cstbMint,
      optxMint: account.optxMint,
      totalHandshakes: BigInt(account.totalHandshakes.toString()),
      totalAttestations: BigInt(account.totalAttestations.toString()),
      totalOptxMinted: BigInt(account.totalOptxMinted.toString()),
      gazeThreshold: BigInt(account.gazeThreshold.toString()),
      computeDifficultyMin: account.computeDifficultyMin,
      entropyPerAttestation: BigInt(account.entropyPerAttestation.toString()),
      optxPerEntropy: BigInt(account.optxPerEntropy.toString()),
      bump: account.bump,
    };
  }

  private parseUserEntropy(account: any): UserEntropyAccount {
    return {
      owner: account.owner,
      totalEntropy: BigInt(account.totalEntropy.toString()),
      entropyUsed: BigInt(account.entropyUsed.toString()),
      attestationCount: BigInt(account.attestationCount.toString()),
      lastAttestation:
        account.lastAttestation.toNumber() > 0
          ? new Date(account.lastAttestation.toNumber() * 1000)
          : null,
      optxMintingAllowance: BigInt(account.optxMintingAllowance.toString()),
      bump: account.bump,
    };
  }

  private parseHandshake(account: any, publicKey: PublicKey): HandshakeAccount {
    return {
      publicKey,
      initiator: account.initiator,
      handshakeId: new Uint8Array(account.handshakeId),
      initiatedAt: new Date(account.initiatedAt.toNumber() * 1000),
      expiresAt: new Date(account.expiresAt.toNumber() * 1000),
      gazeVerified: account.gazeVerified,
      gazeVerifiedAt:
        account.gazeVerifiedAt.toNumber() > 0
          ? new Date(account.gazeVerifiedAt.toNumber() * 1000)
          : null,
      gazeTensorHash: new Uint8Array(account.gazeTensorHash),
      cogVector: account.cogVector as [number, number, number],
      emoVector: account.emoVector as [number, number, number],
      envVector: account.envVector as [number, number, number],
      gazeEntropy: BigInt(account.gazeEntropy.toString()),
      computeVerified: account.computeVerified,
      computeVerifiedAt:
        account.computeVerifiedAt.toNumber() > 0
          ? new Date(account.computeVerifiedAt.toNumber() * 1000)
          : null,
      computeProofHash: new Uint8Array(account.computeProofHash),
      difficultyLevel: account.difficultyLevel,
      deviceType: account.deviceType,
      proofNonce: BigInt(account.proofNonce.toString()),
      computeEntropy: BigInt(account.computeEntropy.toString()),
      attestationComplete: account.attestationComplete,
      bump: account.bump,
    };
  }

  private parseAttestation(account: any): AttestationAccount {
    return {
      owner: account.owner,
      handshakeId: new Uint8Array(account.handshakeId),
      createdAt: new Date(account.createdAt.toNumber() * 1000),
      gazeTensorHash: new Uint8Array(account.gazeTensorHash),
      computeProofHash: new Uint8Array(account.computeProofHash),
      combinedHash: new Uint8Array(account.combinedHash),
      combinedEntropy: BigInt(account.combinedEntropy.toString()),
      optxMinted: BigInt(account.optxMinted.toString()),
      difficultyLevel: account.difficultyLevel,
      deviceType: account.deviceType,
      isValid: account.isValid,
      revokedAt: account.revokedAt
        ? new Date(account.revokedAt.toNumber() * 1000)
        : null,
      bump: account.bump,
    };
  }
}

// ============================================================================
// FACTORY FUNCTION
// ============================================================================

/**
 * Create a TrustClient instance from a connection and wallet
 * @param connection - Solana connection
 * @param wallet - Anchor wallet adapter
 * @param programId - Optional custom program ID
 */
export function createTrustClient(
  connection: Connection,
  wallet: anchor.Wallet,
  programId: PublicKey = PROGRAM_ID
): TrustClient {
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  return new TrustClient(provider, programId);
}

// Export everything needed
export {
  PublicKey,
  Keypair,
  Connection,
  BN,
  AnchorProvider,
} from "@coral-xyz/anchor";
