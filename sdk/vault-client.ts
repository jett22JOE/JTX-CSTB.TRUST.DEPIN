// ============================================================================
// ASTRO KNOTS VAULT — TypeScript SDK (vault-client.ts) v2.1
// ============================================================================
// Client SDK for interacting with the jett_vault Anchor program.
// Includes AGT attestation, biometric proofs, AARON audit, and subscriptions.
//
// Biometric proof hashes are computed off-chain by the JETT Auth SDK
// and passed as opaque 32-byte digests — no cryptographic internals exposed.
//
// Usage:
//   import { VaultClient } from "./sdk/vault-client";
//   const client = new VaultClient(provider);
//   await client.initializeVault(goalLamports, phase1, phase2, multisig);
//   await client.donateSol(amount);
//   await client.createAgtAttestation(gazeTensor, sessionSeed, proofHash, ...);
// ============================================================================

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import {
  PublicKey,
  Keypair,
  Connection,
  TransactionSignature,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

// ============================================================================
// CONSTANTS
// ============================================================================

export const AGT_DIMENSION = 3;
export const AGT_PRECISION = 1_000_000;
export const BASIC_MINT_CAP = 222;
export const UNLIMITED_MINT_CAP = 0xFFFFFFFF;
export const JTX_BASIC_THRESHOLD = 1_000_000n;
export const JTX_UNLIMITED_THRESHOLD = 100_000_000n;

// ============================================================================
// TYPES
// ============================================================================

/** Vault configuration account */
export interface VaultConfigAccount {
  authority: PublicKey;
  goalLamports: bigint;
  raisedLamports: bigint;
  raisedUsdc: bigint;
  donorCount: number;
  agentCount: number;
  phase: number;
  phase1Deadline: Date;
  phase2Deadline: Date;
  isLaunched: boolean;
  isRefundable: boolean;
  paused: boolean;
  multisigSigners: PublicKey[];
  multisigApprovals: boolean[];
  pendingAction: number;
  totalAgtAttestations: number;
  totalAaronAudits: number;
  bump: number;
}

/** Donor account */
export interface DonorAccount {
  wallet: PublicKey;
  amountLamports: bigint;
  donatedAt: Date;
  attested: boolean;
  refundClaimed: boolean;
  referrer: PublicKey | null;
  optxMultiplierBps: number;
  bump: number;
}

/** Agent acquisition account */
export interface AgentAcquisitionAccount {
  agent: PublicKey;
  targetUser: PublicKey;
  usdcAmount: bigint;
  acquiredAt: Date;
  bump: number;
}

/** Agent ledger account */
export interface AgentLedgerAccount {
  agent: PublicKey;
  totalUsdcPaid: bigint;
  usersAcquired: number;
  lastPaymentAt: Date;
  bump: number;
}

/** AGT Attestation account */
export interface AgtAttestationAccount {
  owner: PublicKey;
  agtWeights: bigint[];
  gazeTensor: bigint[];
  dualKey: bigint;
  bilinearScore: bigint;
  tensorHash: Uint8Array;
  biometricProofHash: Uint8Array;
  attestationHash: Uint8Array;
  deviceType: number;
  createdAt: Date;
  isValid: boolean;
  revokedAt: Date | null;
  aaronAuditHash: Uint8Array | null;
  optxMinted: bigint;
  subscriptionTier: number;
  mintCountThisPeriod: number;
  periodStart: Date;
  bump: number;
}

/** AARON Audit account */
export interface AaronAuditAccount {
  agtAttestation: PublicKey;
  auditor: PublicKey;
  auditHash: Uint8Array;
  riskScore: number;
  cogScore: number;
  envScore: number;
  emoScore: number;
  auditNotesHash: Uint8Array;
  auditedAt: Date;
  bump: number;
}

/** Vault event from on-chain logs */
export interface VaultEvent {
  eventType: string;
  user: PublicKey;
  amount: bigint;
  timestamp: Date;
  referrer: PublicKey | null;
  phase: number;
}

// ============================================================================
// PDA HELPERS (exported for external use)
// ============================================================================

const VAULT_PROGRAM_ID = new PublicKey(
  "JVau1tVau1tVau1tVau1tVau1tVau1tVau1tVau1tVau"
);

export function getVaultConfigPDA(
  programId: PublicKey = VAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_config")],
    programId
  );
}

export function getDonorPDA(
  donor: PublicKey,
  programId: PublicKey = VAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("donor"), donor.toBuffer()],
    programId
  );
}

export function getAgentAcquisitionPDA(
  agent: PublicKey,
  user: PublicKey,
  programId: PublicKey = VAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent_acq"), agent.toBuffer(), user.toBuffer()],
    programId
  );
}

export function getAgentLedgerPDA(
  agent: PublicKey,
  programId: PublicKey = VAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent_ledger"), agent.toBuffer()],
    programId
  );
}

export function getAgtAttestationPDA(
  owner: PublicKey,
  programId: PublicKey = VAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agt_attestation"), owner.toBuffer()],
    programId
  );
}

export function getAaronAuditPDA(
  agtAttestation: PublicKey,
  programId: PublicKey = VAULT_PROGRAM_ID
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("aaron_audit"), agtAttestation.toBuffer()],
    programId
  );
}

// ============================================================================
// VAULT CLIENT
// ============================================================================

export class VaultClient {
  readonly program: Program;
  readonly provider: AnchorProvider;
  readonly programId: PublicKey;

  constructor(provider: AnchorProvider, programId?: PublicKey) {
    this.provider = provider;
    this.programId = programId || VAULT_PROGRAM_ID;
    this.program = anchor.workspace.JettVault as Program;
  }

  // ========================================================================
  // READ METHODS
  // ========================================================================

  /** Fetch vault configuration */
  async getVaultConfig(): Promise<VaultConfigAccount> {
    const [pda] = getVaultConfigPDA(this.programId);
    const raw = await this.program.account.vaultConfig.fetch(pda);
    return {
      authority: raw.authority,
      goalLamports: BigInt(raw.goalLamports.toString()),
      raisedLamports: BigInt(raw.raisedLamports.toString()),
      raisedUsdc: BigInt(raw.raisedUsdc.toString()),
      donorCount: raw.donorCount,
      agentCount: raw.agentCount,
      phase: raw.phase,
      phase1Deadline: new Date(raw.phase1Deadline.toNumber() * 1000),
      phase2Deadline: new Date(raw.phase2Deadline.toNumber() * 1000),
      isLaunched: raw.isLaunched,
      isRefundable: raw.isRefundable,
      paused: raw.paused,
      multisigSigners: raw.multisigSigners,
      multisigApprovals: raw.multisigApprovals,
      pendingAction: raw.pendingAction,
      totalAgtAttestations: raw.totalAgtAttestations,
      totalAaronAudits: raw.totalAaronAudits,
      bump: raw.bump,
    };
  }

  /** Fetch donor account */
  async getDonor(donorPubkey: PublicKey): Promise<DonorAccount | null> {
    const [pda] = getDonorPDA(donorPubkey, this.programId);
    try {
      const raw = await this.program.account.donor.fetch(pda);
      return {
        wallet: raw.wallet,
        amountLamports: BigInt(raw.amountLamports.toString()),
        donatedAt: new Date(raw.donatedAt.toNumber() * 1000),
        attested: raw.attested,
        refundClaimed: raw.refundClaimed,
        referrer: raw.referrer,
        optxMultiplierBps: raw.optxMultiplierBps,
        bump: raw.bump,
      };
    } catch {
      return null;
    }
  }

  /** Fetch agent ledger */
  async getAgentLedger(
    agentPubkey: PublicKey
  ): Promise<AgentLedgerAccount | null> {
    const [pda] = getAgentLedgerPDA(agentPubkey, this.programId);
    try {
      const raw = await this.program.account.agentLedger.fetch(pda);
      return {
        agent: raw.agent,
        totalUsdcPaid: BigInt(raw.totalUsdcPaid.toString()),
        usersAcquired: raw.usersAcquired,
        lastPaymentAt: new Date(raw.lastPaymentAt.toNumber() * 1000),
        bump: raw.bump,
      };
    } catch {
      return null;
    }
  }

  /** Fetch AGT attestation */
  async getAgtAttestation(
    owner: PublicKey
  ): Promise<AgtAttestationAccount | null> {
    const [pda] = getAgtAttestationPDA(owner, this.programId);
    try {
      const raw = await this.program.account.agtAttestation.fetch(pda);
      return {
        owner: raw.owner,
        agtWeights: raw.agtWeights.map((w: any) => BigInt(w.toString())),
        gazeTensor: raw.gazeTensor.map((g: any) => BigInt(g.toString())),
        dualKey: BigInt(raw.dualKey.toString()),
        bilinearScore: BigInt(raw.bilinearScore.toString()),
        tensorHash: new Uint8Array(raw.tensorHash),
        biometricProofHash: new Uint8Array(raw.biometricProofHash),
        attestationHash: new Uint8Array(raw.attestationHash),
        deviceType: raw.deviceType,
        createdAt: new Date(raw.createdAt.toNumber() * 1000),
        isValid: raw.isValid,
        revokedAt: raw.revokedAt
          ? new Date(raw.revokedAt.toNumber() * 1000)
          : null,
        aaronAuditHash: raw.aaronAuditHash
          ? new Uint8Array(raw.aaronAuditHash)
          : null,
        optxMinted: BigInt(raw.optxMinted.toString()),
        subscriptionTier: raw.subscriptionTier,
        mintCountThisPeriod: raw.mintCountThisPeriod,
        periodStart: new Date(raw.periodStart.toNumber() * 1000),
        bump: raw.bump,
      };
    } catch {
      return null;
    }
  }

  /** Fetch AARON audit for an AGT attestation */
  async getAaronAudit(
    agtAttestationPDA: PublicKey
  ): Promise<AaronAuditAccount | null> {
    const [pda] = getAaronAuditPDA(agtAttestationPDA, this.programId);
    try {
      const raw = await this.program.account.aaronAuditAccount.fetch(pda);
      return {
        agtAttestation: raw.agtAttestation,
        auditor: raw.auditor,
        auditHash: new Uint8Array(raw.auditHash),
        riskScore: raw.riskScore,
        cogScore: raw.cogScore,
        envScore: raw.envScore,
        emoScore: raw.emoScore,
        auditNotesHash: new Uint8Array(raw.auditNotesHash),
        auditedAt: new Date(raw.auditedAt.toNumber() * 1000),
        bump: raw.bump,
      };
    } catch {
      return null;
    }
  }

  /** Get vault progress as percentage */
  async getProgress(): Promise<{
    raisedSol: number;
    goalSol: number;
    percent: number;
    donors: number;
    agents: number;
    agtAttestations: number;
    aaronAudits: number;
  }> {
    const config = await this.getVaultConfig();
    const raisedSol = Number(config.raisedLamports) / LAMPORTS_PER_SOL;
    const goalSol = Number(config.goalLamports) / LAMPORTS_PER_SOL;
    return {
      raisedSol,
      goalSol,
      percent: (raisedSol / goalSol) * 100,
      donors: config.donorCount,
      agents: config.agentCount,
      agtAttestations: config.totalAgtAttestations,
      aaronAudits: config.totalAaronAudits,
    };
  }

  // ========================================================================
  // WRITE METHODS
  // ========================================================================

  /** Initialize the vault (founder only) */
  async initializeVault(
    goalLamports: BN,
    phase1Deadline: BN,
    phase2Deadline: BN,
    multisigSigners: PublicKey[]
  ): Promise<TransactionSignature> {
    const [vaultConfigPDA] = getVaultConfigPDA(this.programId);

    return this.program.methods
      .initializeVault(goalLamports, phase1Deadline, phase2Deadline, multisigSigners)
      .accounts({
        founder: this.provider.wallet.publicKey,
        vaultConfig: vaultConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Donate SOL to the vault */
  async donateSol(
    amount: BN,
    referrer?: PublicKey
  ): Promise<TransactionSignature> {
    const donor = this.provider.wallet.publicKey;
    const [donorPDA] = getDonorPDA(donor, this.programId);
    const [vaultConfigPDA] = getVaultConfigPDA(this.programId);

    return this.program.methods
      .donateSol(amount, referrer || null)
      .accounts({
        donorSigner: donor,
        donor: donorPDA,
        vaultConfig: vaultConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Agent USDC payment for user acquisition */
  async donateUsdcAgent(
    usdcAmount: BN,
    targetUser: PublicKey,
    agentKeypair?: Keypair
  ): Promise<TransactionSignature> {
    const agent = agentKeypair
      ? agentKeypair.publicKey
      : this.provider.wallet.publicKey;
    const [acquisitionPDA] = getAgentAcquisitionPDA(agent, targetUser, this.programId);
    const [ledgerPDA] = getAgentLedgerPDA(agent, this.programId);
    const [vaultConfigPDA] = getVaultConfigPDA(this.programId);

    const tx = this.program.methods
      .donateUsdcAgent(usdcAmount, targetUser)
      .accounts({
        agentSigner: agent,
        agentAcquisition: acquisitionPDA,
        agentLedger: ledgerPDA,
        vaultConfig: vaultConfigPDA,
        systemProgram: SystemProgram.programId,
      });

    if (agentKeypair) {
      return tx.signers([agentKeypair]).rpc();
    }
    return tx.rpc();
  }

  /** Link gaze attestation to donor (CPI to jtx_optx_devnet_poa_trustjoe) */
  async linkAttestation(
    donorPubkey: PublicKey,
    attestationPDA: PublicKey,
    trustProgramId: PublicKey,
    signer?: Keypair
  ): Promise<TransactionSignature> {
    const [donorPDA] = getDonorPDA(donorPubkey, this.programId);
    const [vaultConfigPDA] = getVaultConfigPDA(this.programId);

    const signerPubkey = signer
      ? signer.publicKey
      : this.provider.wallet.publicKey;

    const tx = this.program.methods.linkAttestation().accounts({
      signer: signerPubkey,
      donor: donorPDA,
      vaultConfig: vaultConfigPDA,
      attestation: attestationPDA,
      trustProgram: trustProgramId,
    });

    if (signer) {
      return tx.signers([signer]).rpc();
    }
    return tx.rpc();
  }

  /** Create AGT attestation with tensor weights and biometric proof hash */
  async createAgtAttestation(
    gazeTensor: BN[],
    sessionSeed: BN[],
    biometricProofHash: number[],
    difficultyFactors: BN[],
    deviceType: number,
    signer?: Keypair
  ): Promise<TransactionSignature> {
    const user = signer
      ? signer.publicKey
      : this.provider.wallet.publicKey;
    const [agtPDA] = getAgtAttestationPDA(user, this.programId);
    const [vaultConfigPDA] = getVaultConfigPDA(this.programId);

    const tx = this.program.methods
      .createAgtAttestation(
        gazeTensor,
        sessionSeed,
        biometricProofHash,
        difficultyFactors,
        deviceType
      )
      .accounts({
        user,
        agtAttestation: agtPDA,
        vaultConfig: vaultConfigPDA,
        systemProgram: SystemProgram.programId,
      });

    if (signer) {
      return tx.signers([signer]).rpc();
    }
    return tx.rpc();
  }

  /** Update AGT weights with new gaze observation */
  async updateAgtWeights(
    newGazeTensor: BN[],
    alphaBps: number,
    signer?: Keypair
  ): Promise<TransactionSignature> {
    const user = signer
      ? signer.publicKey
      : this.provider.wallet.publicKey;
    const [agtPDA] = getAgtAttestationPDA(user, this.programId);
    const [vaultConfigPDA] = getVaultConfigPDA(this.programId);

    const tx = this.program.methods
      .updateAgtWeights(newGazeTensor, alphaBps)
      .accounts({
        user,
        agtAttestation: agtPDA,
        vaultConfig: vaultConfigPDA,
      });

    if (signer) {
      return tx.signers([signer]).rpc();
    }
    return tx.rpc();
  }

  /** AARON audit on an AGT attestation */
  async aaronAudit(
    agtOwner: PublicKey,
    auditHash: number[],
    riskScore: number,
    cogScore: number,
    envScore: number,
    emoScore: number,
    auditNotesHash: number[],
    operatorKeypair?: Keypair
  ): Promise<TransactionSignature> {
    const operator = operatorKeypair
      ? operatorKeypair.publicKey
      : this.provider.wallet.publicKey;
    const [agtPDA] = getAgtAttestationPDA(agtOwner, this.programId);
    const [auditPDA] = getAaronAuditPDA(agtPDA, this.programId);
    const [vaultConfigPDA] = getVaultConfigPDA(this.programId);

    const tx = this.program.methods
      .aaronAudit(auditHash, riskScore, cogScore, envScore, emoScore, auditNotesHash)
      .accounts({
        aaronOperator: operator,
        agtAttestation: agtPDA,
        aaronAuditAccount: auditPDA,
        vaultConfig: vaultConfigPDA,
        systemProgram: SystemProgram.programId,
      });

    if (operatorKeypair) {
      return tx.signers([operatorKeypair]).rpc();
    }
    return tx.rpc();
  }

  /** Set subscription tier on AGT attestation */
  async setSubscription(
    agtOwner: PublicKey,
    tier: number,
    jtxAmount: BN,
    signer?: Keypair
  ): Promise<TransactionSignature> {
    const signerPubkey = signer
      ? signer.publicKey
      : this.provider.wallet.publicKey;
    const [agtPDA] = getAgtAttestationPDA(agtOwner, this.programId);
    const [vaultConfigPDA] = getVaultConfigPDA(this.programId);

    const tx = this.program.methods
      .setSubscription(tier, jtxAmount)
      .accounts({
        signer: signerPubkey,
        agtAttestation: agtPDA,
        vaultConfig: vaultConfigPDA,
      });

    if (signer) {
      return tx.signers([signer]).rpc();
    }
    return tx.rpc();
  }

  /** Mint OPTX tokens */
  async mintOptx(
    baseAmount: BN,
    signer?: Keypair
  ): Promise<TransactionSignature> {
    const user = signer
      ? signer.publicKey
      : this.provider.wallet.publicKey;
    const [agtPDA] = getAgtAttestationPDA(user, this.programId);
    const [vaultConfigPDA] = getVaultConfigPDA(this.programId);

    const tx = this.program.methods
      .mintOptx(baseAmount)
      .accounts({
        user,
        agtAttestation: agtPDA,
        vaultConfig: vaultConfigPDA,
      });

    if (signer) {
      return tx.signers([signer]).rpc();
    }
    return tx.rpc();
  }

  /** Claim proportional SOL refund */
  async claimRefund(): Promise<TransactionSignature> {
    const donor = this.provider.wallet.publicKey;
    const [donorPDA] = getDonorPDA(donor, this.programId);
    const [vaultConfigPDA] = getVaultConfigPDA(this.programId);

    return this.program.methods
      .claimRefund()
      .accounts({
        donorSigner: donor,
        donor: donorPDA,
        vaultConfig: vaultConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
  }

  /** Multisig pause/unpause */
  async setPaused(
    paused: boolean,
    signer?: Keypair
  ): Promise<TransactionSignature> {
    const [vaultConfigPDA] = getVaultConfigPDA(this.programId);
    const signerPubkey = signer
      ? signer.publicKey
      : this.provider.wallet.publicKey;

    const tx = this.program.methods.setPaused(paused).accounts({
      signer: signerPubkey,
      vaultConfig: vaultConfigPDA,
    });

    if (signer) {
      return tx.signers([signer]).rpc();
    }
    return tx.rpc();
  }

  /** Revoke an AGT attestation (founder only) */
  async revokeAttestation(
    agtOwner: PublicKey
  ): Promise<TransactionSignature> {
    const [agtPDA] = getAgtAttestationPDA(agtOwner, this.programId);
    const [vaultConfigPDA] = getVaultConfigPDA(this.programId);

    return this.program.methods
      .revokeAttestation()
      .accounts({
        signer: this.provider.wallet.publicKey,
        agtAttestation: agtPDA,
        vaultConfig: vaultConfigPDA,
      })
      .rpc();
  }
}
