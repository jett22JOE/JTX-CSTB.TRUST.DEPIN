// ============================================================================
// ASTRO KNOTS VAULT — Test Suite v2.1 (Scrubbed)
// ============================================================================
// Tests for jett_vault Anchor program with AGT math, biometric proofs,
// AARON audit, subscription tiers, and fundraising mechanics.
//
// Biometric proof hashes are computed off-chain and passed as opaque
// 32-byte digests — no cryptographic internals exposed on-chain.
//
// Run: anchor test
// ============================================================================

import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { expect } from "chai";
import { createHash } from "crypto";

// Import the program IDL (generated after anchor build)
import { JettVault } from "../target/types/jett_vault";

// ============================================================================
// CONSTANTS
// ============================================================================

const GOAL_SOL = 5_874;
const GOAL_LAMPORTS = new BN(GOAL_SOL).mul(new BN(LAMPORTS_PER_SOL));
const ONE_SOL = new BN(LAMPORTS_PER_SOL);
const MULTIPLIER_DEFAULT = 100;
const MULTIPLIER_REFERRED = 150;
const AGT_PRECISION = 1_000_000;

// AGT test data: COG=40%, ENV=35%, EMO=25% (sum = 1.0 in fixed-point)
const TEST_GAZE_TENSOR = [
  new BN(400_000), // COG
  new BN(350_000), // ENV
  new BN(250_000), // EMO
];

const TEST_SESSION_SEED = [
  new BN(333_333),
  new BN(333_334),
  new BN(333_333),
];

const TEST_DIFFICULTY_FACTORS = [
  new BN(500_000), // COG difficulty
  new BN(300_000), // ENV difficulty
  new BN(200_000), // EMO difficulty
];

// Biometric proof hash — opaque 32-byte digest from off-chain engine
const TEST_BIOMETRIC_PROOF_HASH = Array.from(
  createHash("sha256").update(Buffer.from("biometric_proof_test_v1")).digest()
);

// ============================================================================
// PDA HELPERS
// ============================================================================

function getVaultConfigPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_config")],
    programId
  );
}

function getDonorPDA(
  donor: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("donor"), donor.toBuffer()],
    programId
  );
}

function getAgentAcquisitionPDA(
  agent: PublicKey,
  user: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent_acq"), agent.toBuffer(), user.toBuffer()],
    programId
  );
}

function getAgentLedgerPDA(
  agent: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agent_ledger"), agent.toBuffer()],
    programId
  );
}

function getAgtAttestationPDA(
  owner: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("agt_attestation"), owner.toBuffer()],
    programId
  );
}

function getAaronAuditPDA(
  agtAttestation: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("aaron_audit"), agtAttestation.toBuffer()],
    programId
  );
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe("jett-vault (v2.1 — Scrubbed)", () => {
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.JettVault as Program<JettVault>;
  const programId = program.programId;

  // Test wallets
  const founder = provider.wallet;
  const donor1 = Keypair.generate();
  const donor2 = Keypair.generate();
  const agent1 = Keypair.generate();
  const targetUser = Keypair.generate();
  const gazeUser = Keypair.generate();
  const aaronOperator = Keypair.generate();

  // Multisig signers (founder + 2 additional)
  const multisigSigner2 = Keypair.generate();
  const multisigSigner3 = Keypair.generate();

  // Trust program ID (for CPI testing)
  const trustProgramId = new PublicKey(
    "79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF"
  );

  // PDAs
  let vaultConfigPDA: PublicKey;
  let vaultConfigBump: number;

  // Future deadlines
  const now = Math.floor(Date.now() / 1000);
  const phase1Deadline = new BN(now + 30 * 24 * 60 * 60);
  const phase2Deadline = new BN(now + 60 * 24 * 60 * 60);

  before(async () => {
    [vaultConfigPDA, vaultConfigBump] = getVaultConfigPDA(programId);

    const airdropAmount = 10 * LAMPORTS_PER_SOL;

    await Promise.all([
      provider.connection.requestAirdrop(donor1.publicKey, airdropAmount),
      provider.connection.requestAirdrop(donor2.publicKey, airdropAmount),
      provider.connection.requestAirdrop(agent1.publicKey, airdropAmount),
      provider.connection.requestAirdrop(gazeUser.publicKey, airdropAmount),
      provider.connection.requestAirdrop(aaronOperator.publicKey, airdropAmount),
      provider.connection.requestAirdrop(multisigSigner2.publicKey, airdropAmount),
      provider.connection.requestAirdrop(multisigSigner3.publicKey, airdropAmount),
    ]);

    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  // ========================================================================
  // TEST 1: Initialize Vault
  // ========================================================================

  it("initializes vault with correct parameters", async () => {
    const multisigSigners = [
      founder.publicKey,
      multisigSigner2.publicKey,
      multisigSigner3.publicKey,
    ];

    await program.methods
      .initializeVault(
        GOAL_LAMPORTS,
        phase1Deadline,
        phase2Deadline,
        multisigSigners
      )
      .accounts({
        founder: founder.publicKey,
        vaultConfig: vaultConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const vault = await program.account.vaultConfig.fetch(vaultConfigPDA);

    expect(vault.authority.toBase58()).to.equal(founder.publicKey.toBase58());
    expect(vault.goalLamports.toString()).to.equal(GOAL_LAMPORTS.toString());
    expect(vault.raisedLamports.toNumber()).to.equal(0);
    expect(vault.raisedUsdc.toNumber()).to.equal(0);
    expect(vault.donorCount).to.equal(0);
    expect(vault.agentCount).to.equal(0);
    expect(vault.phase).to.equal(1);
    expect(vault.isLaunched).to.equal(false);
    expect(vault.isRefundable).to.equal(false);
    expect(vault.paused).to.equal(false);
    expect(vault.multisigSigners.length).to.equal(3);
    expect(vault.totalAgtAttestations).to.equal(0);
    expect(vault.totalAaronAudits).to.equal(0);

    console.log("  Vault PDA:", vaultConfigPDA.toBase58());
    console.log("  Goal:", GOAL_SOL, "SOL");
  });

  // ========================================================================
  // TEST 2: Donate SOL (no referrer)
  // ========================================================================

  it("accepts SOL donation without referrer", async () => {
    const donateAmount = ONE_SOL;
    const [donorPDA] = getDonorPDA(donor1.publicKey, programId);

    await program.methods
      .donateSol(donateAmount, null)
      .accounts({
        donorSigner: donor1.publicKey,
        donor: donorPDA,
        vaultConfig: vaultConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([donor1])
      .rpc();

    const donor = await program.account.donor.fetch(donorPDA);
    expect(donor.amountLamports.toString()).to.equal(donateAmount.toString());
    expect(donor.attested).to.equal(false);
    expect(donor.refundClaimed).to.equal(false);
    expect(donor.referrer).to.equal(null);
    expect(donor.optxMultiplierBps).to.equal(MULTIPLIER_DEFAULT);

    const vault = await program.account.vaultConfig.fetch(vaultConfigPDA);
    expect(vault.raisedLamports.toString()).to.equal(donateAmount.toString());
    expect(vault.donorCount).to.equal(1);

    console.log("  Donor 1:", donor1.publicKey.toBase58());
    console.log("  Donated:", donateAmount.toNumber() / LAMPORTS_PER_SOL, "SOL");
  });

  // ========================================================================
  // TEST 3: Donate SOL (with referrer)
  // ========================================================================

  it("accepts SOL donation with referrer", async () => {
    const donateAmount = new BN(2 * LAMPORTS_PER_SOL);
    const [donorPDA] = getDonorPDA(donor2.publicKey, programId);

    await program.methods
      .donateSol(donateAmount, donor1.publicKey)
      .accounts({
        donorSigner: donor2.publicKey,
        donor: donorPDA,
        vaultConfig: vaultConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([donor2])
      .rpc();

    const donor = await program.account.donor.fetch(donorPDA);
    expect(donor.amountLamports.toString()).to.equal(donateAmount.toString());
    expect(donor.referrer.toBase58()).to.equal(donor1.publicKey.toBase58());
    expect(donor.optxMultiplierBps).to.equal(MULTIPLIER_DEFAULT);

    const vault = await program.account.vaultConfig.fetch(vaultConfigPDA);
    expect(vault.donorCount).to.equal(2);

    console.log("  Donor 2 referred by Donor 1");
  });

  // ========================================================================
  // TEST 4: Donate USDC Agent
  // ========================================================================

  it("records agent USDC acquisition", async () => {
    const usdcAmount = new BN(50_000_000);

    const [acquisitionPDA] = getAgentAcquisitionPDA(
      agent1.publicKey,
      targetUser.publicKey,
      programId
    );
    const [ledgerPDA] = getAgentLedgerPDA(agent1.publicKey, programId);

    await program.methods
      .donateUsdcAgent(usdcAmount, targetUser.publicKey)
      .accounts({
        agentSigner: agent1.publicKey,
        agentAcquisition: acquisitionPDA,
        agentLedger: ledgerPDA,
        vaultConfig: vaultConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([agent1])
      .rpc();

    const acquisition = await program.account.agentAcquisition.fetch(acquisitionPDA);
    expect(acquisition.agent.toBase58()).to.equal(agent1.publicKey.toBase58());
    expect(acquisition.targetUser.toBase58()).to.equal(targetUser.publicKey.toBase58());
    expect(acquisition.usdcAmount.toString()).to.equal(usdcAmount.toString());

    const ledger = await program.account.agentLedger.fetch(ledgerPDA);
    expect(ledger.totalUsdcPaid.toString()).to.equal(usdcAmount.toString());
    expect(ledger.usersAcquired).to.equal(1);

    const vault = await program.account.vaultConfig.fetch(vaultConfigPDA);
    expect(vault.agentCount).to.equal(1);

    console.log("  Agent:", agent1.publicKey.toBase58());
    console.log("  USDC paid:", usdcAmount.toNumber() / 1_000_000);
  });

  // ========================================================================
  // TEST 5: Reject zero donation
  // ========================================================================

  it("rejects zero SOL donation", async () => {
    const donor3 = Keypair.generate();
    await provider.connection.requestAirdrop(donor3.publicKey, LAMPORTS_PER_SOL);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const [donorPDA] = getDonorPDA(donor3.publicKey, programId);

    try {
      await program.methods
        .donateSol(new BN(0), null)
        .accounts({
          donorSigner: donor3.publicKey,
          donor: donorPDA,
          vaultConfig: vaultConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([donor3])
        .rpc();

      expect.fail("Should have thrown ZeroAmount error");
    } catch (err) {
      expect(err.error.errorCode.code).to.equal("ZeroAmount");
    }
  });

  // ========================================================================
  // TEST 6: Reject refund when not refundable
  // ========================================================================

  it("rejects refund claim when vault is not refundable", async () => {
    const [donorPDA] = getDonorPDA(donor1.publicKey, programId);

    try {
      await program.methods
        .claimRefund()
        .accounts({
          donorSigner: donor1.publicKey,
          donor: donorPDA,
          vaultConfig: vaultConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([donor1])
        .rpc();

      expect.fail("Should have thrown NotRefundable error");
    } catch (err) {
      expect(err.error.errorCode.code).to.equal("NotRefundable");
    }
  });

  // ========================================================================
  // TEST 7: Create AGT Attestation (with biometric proof hash)
  // ========================================================================

  it("creates AGT attestation with valid simplex tensor + biometric proof", async () => {
    const [agtPDA] = getAgtAttestationPDA(gazeUser.publicKey, programId);

    await program.methods
      .createAgtAttestation(
        TEST_GAZE_TENSOR,
        TEST_SESSION_SEED,
        TEST_BIOMETRIC_PROOF_HASH,
        TEST_DIFFICULTY_FACTORS,
        1 // mobile/MOJO device
      )
      .accounts({
        user: gazeUser.publicKey,
        agtAttestation: agtPDA,
        vaultConfig: vaultConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([gazeUser])
      .rpc();

    const agt = await program.account.agtAttestation.fetch(agtPDA);

    expect(agt.owner.toBase58()).to.equal(gazeUser.publicKey.toBase58());
    expect(agt.isValid).to.equal(true);
    expect(agt.deviceType).to.equal(1);
    expect(agt.subscriptionTier).to.equal(0);
    expect(agt.optxMinted.toNumber()).to.equal(0);
    expect(agt.aaronAuditHash).to.equal(null);

    // Verify weights sum to ~AGT_PRECISION
    const weightSum = agt.agtWeights.reduce(
      (acc: number, w: any) => acc + w.toNumber(),
      0
    );
    expect(weightSum).to.be.closeTo(AGT_PRECISION, AGT_PRECISION / 100);

    // Verify hashes are 32 bytes
    expect(agt.tensorHash.length).to.equal(32);
    expect(agt.biometricProofHash.length).to.equal(32);
    expect(agt.attestationHash.length).to.equal(32);

    const vault = await program.account.vaultConfig.fetch(vaultConfigPDA);
    expect(vault.totalAgtAttestations).to.equal(1);

    console.log("  AGT user:", gazeUser.publicKey.toBase58());
    console.log("  Bilinear score:", agt.bilinearScore.toNumber());
    console.log("  Dual key:", agt.dualKey.toNumber());
    console.log("  Biometric proof hash: [32 bytes]");
  });

  // ========================================================================
  // TEST 8: Reject invalid simplex tensor
  // ========================================================================

  it("rejects AGT attestation with invalid simplex tensor", async () => {
    const badUser = Keypair.generate();
    await provider.connection.requestAirdrop(badUser.publicKey, LAMPORTS_PER_SOL);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const [agtPDA] = getAgtAttestationPDA(badUser.publicKey, programId);

    // Tensor that doesn't sum to ~1.0 (sum = 2.0)
    const badTensor = [
      new BN(800_000),
      new BN(700_000),
      new BN(500_000),
    ];

    try {
      await program.methods
        .createAgtAttestation(
          badTensor,
          TEST_SESSION_SEED,
          TEST_BIOMETRIC_PROOF_HASH,
          TEST_DIFFICULTY_FACTORS,
          0
        )
        .accounts({
          user: badUser.publicKey,
          agtAttestation: agtPDA,
          vaultConfig: vaultConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([badUser])
        .rpc();

      expect.fail("Should have thrown InvalidSimplexProjection error");
    } catch (err) {
      expect(err.error.errorCode.code).to.equal("InvalidSimplexProjection");
    }
  });

  // ========================================================================
  // TEST 9: Update AGT Weights
  // ========================================================================

  it("updates AGT weights with new gaze observation", async () => {
    const [agtPDA] = getAgtAttestationPDA(gazeUser.publicKey, programId);

    const oldAgt = await program.account.agtAttestation.fetch(agtPDA);
    const oldDualKey = oldAgt.dualKey.toNumber();

    // New observation: shifted toward EMO
    const newTensor = [
      new BN(300_000), // COG
      new BN(300_000), // ENV
      new BN(400_000), // EMO
    ];

    await program.methods
      .updateAgtWeights(newTensor, 1000) // α = 10%
      .accounts({
        user: gazeUser.publicKey,
        agtAttestation: agtPDA,
        vaultConfig: vaultConfigPDA,
      })
      .signers([gazeUser])
      .rpc();

    const agt = await program.account.agtAttestation.fetch(agtPDA);

    // Weights should have shifted slightly toward EMO
    const weightSum = agt.agtWeights.reduce(
      (acc: number, w: any) => acc + w.toNumber(),
      0
    );
    expect(weightSum).to.be.closeTo(AGT_PRECISION, AGT_PRECISION / 100);

    // Dual key should have changed
    expect(agt.dualKey.toNumber()).to.not.equal(oldDualKey);

    // Attestation hash should have changed (tensor_hash changed, biometric_proof_hash same)
    expect(Buffer.from(agt.attestationHash)).to.not.deep.equal(
      Buffer.from(oldAgt.attestationHash)
    );

    console.log("  Updated weights:", agt.agtWeights.map((w: any) => w.toNumber()));
    console.log("  New dual key:", agt.dualKey.toNumber());
  });

  // ========================================================================
  // TEST 10: AARON Audit
  // ========================================================================

  it("records AARON audit on AGT attestation", async () => {
    const [agtPDA] = getAgtAttestationPDA(gazeUser.publicKey, programId);
    const [auditPDA] = getAaronAuditPDA(agtPDA, programId);

    // Compute audit hash off-chain (simulating AARON operator)
    const auditHash = createHash("sha256")
      .update(Buffer.from("test_audit_hash"))
      .digest();
    const notesHash = createHash("sha256")
      .update(Buffer.from("test_audit_notes"))
      .digest();

    await program.methods
      .aaronAudit(
        Array.from(auditHash),
        2500,  // risk score: 25%
        3000,  // COG: 30%
        2000,  // ENV: 20%
        2500,  // EMO: 25%
        Array.from(notesHash)
      )
      .accounts({
        aaronOperator: aaronOperator.publicKey,
        agtAttestation: agtPDA,
        aaronAuditAccount: auditPDA,
        vaultConfig: vaultConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([aaronOperator])
      .rpc();

    const audit = await program.account.aaronAuditAccount.fetch(auditPDA);
    expect(audit.riskScore).to.equal(2500);
    expect(audit.cogScore).to.equal(3000);
    expect(audit.envScore).to.equal(2000);
    expect(audit.emoScore).to.equal(2500);
    expect(audit.auditor.toBase58()).to.equal(aaronOperator.publicKey.toBase58());

    // Verify AGT now has audit hash stamped
    const agt = await program.account.agtAttestation.fetch(agtPDA);
    expect(agt.aaronAuditHash).to.not.equal(null);

    const vault = await program.account.vaultConfig.fetch(vaultConfigPDA);
    expect(vault.totalAaronAudits).to.equal(1);

    console.log("  AARON audit PDA:", auditPDA.toBase58());
    console.log("  Risk score:", audit.riskScore, "bps");
  });

  // ========================================================================
  // TEST 11: Reject duplicate AARON audit
  // ========================================================================

  it("rejects duplicate AARON audit on same attestation", async () => {
    const [agtPDA] = getAgtAttestationPDA(gazeUser.publicKey, programId);

    try {
      const fakeAuditHash = createHash("sha256")
        .update(Buffer.from("second_audit"))
        .digest();
      const fakeNotesHash = createHash("sha256")
        .update(Buffer.from("second_notes"))
        .digest();

      const [auditPDA] = getAaronAuditPDA(agtPDA, programId);

      await program.methods
        .aaronAudit(
          Array.from(fakeAuditHash),
          5000, 5000, 5000, 5000,
          Array.from(fakeNotesHash)
        )
        .accounts({
          aaronOperator: aaronOperator.publicKey,
          agtAttestation: agtPDA,
          aaronAuditAccount: auditPDA,
          vaultConfig: vaultConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([aaronOperator])
        .rpc();

      expect.fail("Should have thrown error");
    } catch (err) {
      expect(err).to.exist;
    }
  });

  // ========================================================================
  // TEST 12: Set Subscription (Basic)
  // ========================================================================

  it("sets Basic subscription tier with sufficient JTX", async () => {
    const [agtPDA] = getAgtAttestationPDA(gazeUser.publicKey, programId);

    await program.methods
      .setSubscription(1, new BN(1_000_000)) // tier=1 (Basic), 1 JTX
      .accounts({
        signer: gazeUser.publicKey,
        agtAttestation: agtPDA,
        vaultConfig: vaultConfigPDA,
      })
      .signers([gazeUser])
      .rpc();

    const agt = await program.account.agtAttestation.fetch(agtPDA);
    expect(agt.subscriptionTier).to.equal(1);
    expect(agt.mintCountThisPeriod).to.equal(0);

    console.log("  Subscription tier: Basic (222/month)");
  });

  // ========================================================================
  // TEST 13: Reject subscription with insufficient JTX
  // ========================================================================

  it("rejects Unlimited subscription with insufficient JTX", async () => {
    const [agtPDA] = getAgtAttestationPDA(gazeUser.publicKey, programId);

    try {
      await program.methods
        .setSubscription(2, new BN(1_000_000)) // tier=2 but only 1 JTX (need 100)
        .accounts({
          signer: gazeUser.publicKey,
          agtAttestation: agtPDA,
          vaultConfig: vaultConfigPDA,
        })
        .signers([gazeUser])
        .rpc();

      expect.fail("Should have thrown InsufficientJtx error");
    } catch (err) {
      expect(err.error.errorCode.code).to.equal("InsufficientJtx");
    }
  });

  // ========================================================================
  // TEST 14: Mint OPTX
  // ========================================================================

  it("mints OPTX with valid attestation + audit + subscription", async () => {
    const [agtPDA] = getAgtAttestationPDA(gazeUser.publicKey, programId);

    await program.methods
      .mintOptx(new BN(1_000_000)) // 1 OPTX
      .accounts({
        user: gazeUser.publicKey,
        agtAttestation: agtPDA,
        vaultConfig: vaultConfigPDA,
      })
      .signers([gazeUser])
      .rpc();

    const agt = await program.account.agtAttestation.fetch(agtPDA);
    expect(agt.optxMinted.toNumber()).to.equal(1_000_000);
    expect(agt.mintCountThisPeriod).to.equal(1);

    console.log("  Minted: 1 OPTX | count:", agt.mintCountThisPeriod, "/ 222");
  });

  // ========================================================================
  // TEST 15: Reject mint without audit
  // ========================================================================

  it("rejects OPTX mint without AARON audit", async () => {
    const noAuditUser = Keypair.generate();
    await provider.connection.requestAirdrop(noAuditUser.publicKey, 2 * LAMPORTS_PER_SOL);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const [agtPDA] = getAgtAttestationPDA(noAuditUser.publicKey, programId);

    // Create attestation but no audit
    await program.methods
      .createAgtAttestation(
        TEST_GAZE_TENSOR,
        TEST_SESSION_SEED,
        TEST_BIOMETRIC_PROOF_HASH,
        TEST_DIFFICULTY_FACTORS,
        0
      )
      .accounts({
        user: noAuditUser.publicKey,
        agtAttestation: agtPDA,
        vaultConfig: vaultConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([noAuditUser])
      .rpc();

    try {
      await program.methods
        .mintOptx(new BN(1_000_000))
        .accounts({
          user: noAuditUser.publicKey,
          agtAttestation: agtPDA,
          vaultConfig: vaultConfigPDA,
        })
        .signers([noAuditUser])
        .rpc();

      expect.fail("Should have thrown AuditRequired error");
    } catch (err) {
      expect(err.error.errorCode.code).to.equal("AuditRequired");
    }
  });

  // ========================================================================
  // TEST 16: Multisig pause (single approval not enough)
  // ========================================================================

  it("does not pause with single multisig approval", async () => {
    await program.methods
      .setPaused(true)
      .accounts({
        signer: founder.publicKey,
        vaultConfig: vaultConfigPDA,
      })
      .rpc();

    const vault = await program.account.vaultConfig.fetch(vaultConfigPDA);
    expect(vault.paused).to.equal(false);

    console.log("  Single approval: vault still unpaused (need 2-of-3)");
  });

  // ========================================================================
  // TEST 17: Multisig pause (2nd approval triggers)
  // ========================================================================

  it("pauses vault with 2-of-3 multisig approval", async () => {
    await program.methods
      .setPaused(true)
      .accounts({
        signer: multisigSigner2.publicKey,
        vaultConfig: vaultConfigPDA,
      })
      .signers([multisigSigner2])
      .rpc();

    const vault = await program.account.vaultConfig.fetch(vaultConfigPDA);
    expect(vault.paused).to.equal(true);

    console.log("  2-of-3 approved: vault PAUSED");
  });

  // ========================================================================
  // TEST 18: Reject donation when paused
  // ========================================================================

  it("rejects donation when vault is paused", async () => {
    const donor4 = Keypair.generate();
    await provider.connection.requestAirdrop(donor4.publicKey, 2 * LAMPORTS_PER_SOL);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const [donorPDA] = getDonorPDA(donor4.publicKey, programId);

    try {
      await program.methods
        .donateSol(ONE_SOL, null)
        .accounts({
          donorSigner: donor4.publicKey,
          donor: donorPDA,
          vaultConfig: vaultConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([donor4])
        .rpc();

      expect.fail("Should have thrown VaultPaused error");
    } catch (err) {
      expect(err.error.errorCode.code).to.equal("VaultPaused");
    }
  });

  // ========================================================================
  // TEST 19: Unpause vault
  // ========================================================================

  it("unpauses vault with multisig", async () => {
    await program.methods
      .setPaused(false)
      .accounts({
        signer: founder.publicKey,
        vaultConfig: vaultConfigPDA,
      })
      .rpc();

    await program.methods
      .setPaused(false)
      .accounts({
        signer: multisigSigner3.publicKey,
        vaultConfig: vaultConfigPDA,
      })
      .signers([multisigSigner3])
      .rpc();

    const vault = await program.account.vaultConfig.fetch(vaultConfigPDA);
    expect(vault.paused).to.equal(false);

    console.log("  Vault UNPAUSED (2-of-3 approved)");
  });

  // ========================================================================
  // TEST 20: Revoke attestation
  // ========================================================================

  it("revokes AGT attestation (founder only)", async () => {
    const revokeUser = Keypair.generate();
    await provider.connection.requestAirdrop(revokeUser.publicKey, 2 * LAMPORTS_PER_SOL);
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const [agtPDA] = getAgtAttestationPDA(revokeUser.publicKey, programId);

    await program.methods
      .createAgtAttestation(
        TEST_GAZE_TENSOR,
        TEST_SESSION_SEED,
        TEST_BIOMETRIC_PROOF_HASH,
        TEST_DIFFICULTY_FACTORS,
        0
      )
      .accounts({
        user: revokeUser.publicKey,
        agtAttestation: agtPDA,
        vaultConfig: vaultConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([revokeUser])
      .rpc();

    // Founder revokes
    await program.methods
      .revokeAttestation()
      .accounts({
        signer: founder.publicKey,
        agtAttestation: agtPDA,
        vaultConfig: vaultConfigPDA,
      })
      .rpc();

    const agt = await program.account.agtAttestation.fetch(agtPDA);
    expect(agt.isValid).to.equal(false);
    expect(agt.revokedAt).to.not.equal(null);

    console.log("  Attestation revoked for:", revokeUser.publicKey.toBase58());
  });

  // ========================================================================
  // TEST 21: Verify vault totals
  // ========================================================================

  it("has correct aggregate totals", async () => {
    const vault = await program.account.vaultConfig.fetch(vaultConfigPDA);

    // 1 SOL + 2 SOL = 3 SOL total
    expect(vault.raisedLamports.toString()).to.equal(
      new BN(3 * LAMPORTS_PER_SOL).toString()
    );
    // 50 USDC from agent
    expect(vault.raisedUsdc.toString()).to.equal("50000000");
    // 2 human donors + 1 agent
    expect(vault.donorCount).to.equal(2);
    expect(vault.agentCount).to.equal(1);
    // AGT attestations (gazeUser + noAuditUser + revokeUser = 3)
    expect(vault.totalAgtAttestations).to.equal(3);
    // AARON audits (1 for gazeUser)
    expect(vault.totalAaronAudits).to.equal(1);

    console.log("  Total SOL:", vault.raisedLamports.toNumber() / LAMPORTS_PER_SOL);
    console.log("  Total USDC:", vault.raisedUsdc.toNumber() / 1_000_000);
    console.log("  Donors:", vault.donorCount, "| Agents:", vault.agentCount);
    console.log("  AGT attestations:", vault.totalAgtAttestations);
    console.log("  AARON audits:", vault.totalAaronAudits);
  });
});
