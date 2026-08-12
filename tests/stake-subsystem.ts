// ============================================================================
// JETT-VAULT v2.1 — Stake Subsystem Test Suite (B3.6)
// ============================================================================
// Covers the 9 stake-subsystem cases from the v2.1 design
// (see docs/stake-subsystem-design.md):
//   (a) stake_for_tier success path
//   (b) stake_for_tier insufficient balance reject
//   (c) unstake before expiry reject
//   (d) unstake after expiry success            [SKIPPED — needs bankrun warp_to]
//   (e) restake_upgrade MOJO→DOJO success
//   (f) restake_upgrade downgrade reject
//   (g) SPACE COWBOY unstake LifetimeStakePermanent reject
//   (h) deprecated set_subscription returns Deprecated
//   (i) migrate_v2_thresholds — multisig reject path
//       (happy path SKIPPED — current vault has no approve_migrate
//        instruction; set_paused resets approvals on threshold, so 2-of-3
//        cannot be assembled for a non-pause action without code changes.)
//
// Uses a localnet-minted Token-2022 mock JTX (StakeForTier has no canonical
// mint constraint, so any Token-2022 mint suffices for tests). The
// stake_vault_ata is created on first stake via init_if_needed.
//
// Run via:  anchor test                              (whole repo)
//        or anchor test --skip-build (after one build)
// ============================================================================

import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  createMint,
  createAssociatedTokenAccountIdempotent,
  mintTo,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { expect } from "chai";
import { createHash } from "crypto";

import { JettVault } from "../target/types/jett_vault";

// ─── shared-constants mirror (must match programs/shared-constants/src/lib.rs) ─
const JTX_DECIMALS_RAW = new BN("1000000000"); // 9 decimals
const MOJO_THRESHOLD = JTX_DECIMALS_RAW.muln(12);
const DOJO_THRESHOLD = JTX_DECIMALS_RAW.muln(444);
const SPACE_COWBOY_THRESHOLD = JTX_DECIMALS_RAW.muln(1_111);

const TIER_MOJO = 1;
const TIER_DOJO = 2;
const TIER_SPACE_COWBOY = 3;

const GOAL_LAMPORTS = new BN(5_874).mul(new BN(LAMPORTS_PER_SOL));
const AGT_PRECISION = 1_000_000;
const TEST_GAZE_TENSOR = [
  new BN(400_000),
  new BN(350_000),
  new BN(250_000),
];
const TEST_SESSION_SEED = [
  new BN(333_333),
  new BN(333_334),
  new BN(333_333),
];
const TEST_DIFFICULTY_FACTORS = [
  new BN(500_000),
  new BN(300_000),
  new BN(200_000),
];
const TEST_BIOMETRIC_PROOF_HASH = Array.from(
  createHash("sha256").update(Buffer.from("stake-test-biometric-v1")).digest()
);

// ─── PDA helpers ──────────────────────────────────────────────────────────────

const seed = (s: string) => Buffer.from(s);

const findPda = (seeds: (Buffer | Uint8Array)[], programId: PublicKey) =>
  PublicKey.findProgramAddressSync(seeds, programId);

const getVaultConfigPDA = (programId: PublicKey) =>
  findPda([seed("vault_config")], programId);

const getAgtAttestationPDA = (owner: PublicKey, programId: PublicKey) =>
  findPda([seed("agt_attestation"), owner.toBuffer()], programId);

const getStakePositionPDA = (owner: PublicKey, programId: PublicKey) =>
  findPda([seed("stake"), owner.toBuffer()], programId);

const getStakeVaultAuthorityPDA = (
  vaultConfig: PublicKey,
  programId: PublicKey
) => findPda([seed("stake_vault_authority"), vaultConfig.toBuffer()], programId);

// ─── Tier user fixture ────────────────────────────────────────────────────────

interface TierUser {
  kp: Keypair;
  ata: PublicKey;
  agtPda: PublicKey;
}

// ============================================================================
// SUITE
// ============================================================================

describe("jett-vault v2.1 — stake subsystem", function () {
  this.timeout(120_000);

  const provider = AnchorProvider.env();
  anchor.setProvider(provider);
  const program = anchor.workspace.JettVault as Program<JettVault>;
  const programId = program.programId;
  const connection = provider.connection;
  const founder = (provider.wallet as anchor.Wallet).payer;

  // Multisig signers (must match those used in jett-vault.ts if it ran first;
  // otherwise we initialize with our own and skip jett-vault.ts coordination).
  const multisigSigner2 = Keypair.generate();
  const multisigSigner3 = Keypair.generate();

  // Mock JTX mint (founder = mint authority).
  let jtxMint: PublicKey;

  // Test users — one per scenario to keep PDAs independent.
  const mojoUser: TierUser = { kp: Keypair.generate(), ata: PublicKey.default, agtPda: PublicKey.default };
  const insufficientUser: TierUser = { kp: Keypair.generate(), ata: PublicKey.default, agtPda: PublicKey.default };
  const earlyExitUser: TierUser = { kp: Keypair.generate(), ata: PublicKey.default, agtPda: PublicKey.default };
  const upgradeUser: TierUser = { kp: Keypair.generate(), ata: PublicKey.default, agtPda: PublicKey.default };
  const cowboyUser: TierUser = { kp: Keypair.generate(), ata: PublicKey.default, agtPda: PublicKey.default };
  const deprecatedUser: TierUser = { kp: Keypair.generate(), ata: PublicKey.default, agtPda: PublicKey.default };

  let vaultConfigPDA: PublicKey;
  let stakeVaultAuthorityPDA: PublicKey;
  let stakeVaultAta: PublicKey;

  // ─── Setup ──────────────────────────────────────────────────────────────────

  before(async () => {
    [vaultConfigPDA] = getVaultConfigPDA(programId);

    // Idempotent vault init — fine to noop if jett-vault.ts already ran.
    const existing = await connection.getAccountInfo(vaultConfigPDA);
    if (!existing) {
      const now = Math.floor(Date.now() / 1000);
      await program.methods
        .initializeVault(
          GOAL_LAMPORTS,
          new BN(now + 30 * 24 * 60 * 60),
          new BN(now + 60 * 24 * 60 * 60),
          [founder.publicKey, multisigSigner2.publicKey, multisigSigner3.publicKey]
        )
        .accounts({
          founder: founder.publicKey,
          vaultConfig: vaultConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    // Mock JTX Token-2022 mint (9 decimals, founder = mint authority).
    jtxMint = await createMint(
      connection,
      founder,
      founder.publicKey,
      null,
      9,
      Keypair.generate(),
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    [stakeVaultAuthorityPDA] = getStakeVaultAuthorityPDA(vaultConfigPDA, programId);
    stakeVaultAta = getAssociatedTokenAddressSync(
      jtxMint,
      stakeVaultAuthorityPDA,
      true, // allowOwnerOffCurve — PDA
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );

    // Airdrop SOL + multisig signers.
    const airdropTargets = [
      multisigSigner2.publicKey,
      multisigSigner3.publicKey,
      mojoUser.kp.publicKey,
      insufficientUser.kp.publicKey,
      earlyExitUser.kp.publicKey,
      upgradeUser.kp.publicKey,
      cowboyUser.kp.publicKey,
      deprecatedUser.kp.publicKey,
    ];
    await Promise.all(
      airdropTargets.map((pk) =>
        connection.requestAirdrop(pk, 5 * LAMPORTS_PER_SOL)
      )
    );
    await new Promise((r) => setTimeout(r, 2_500));

    // Per-user setup: AGT attestation + JTX ATA + JTX balance.
    const setupUser = async (u: TierUser, jtxAmount: BN | null) => {
      [u.agtPda] = getAgtAttestationPDA(u.kp.publicKey, programId);

      // AGT attestation.
      await program.methods
        .createAgtAttestation(
          TEST_GAZE_TENSOR,
          TEST_SESSION_SEED,
          TEST_BIOMETRIC_PROOF_HASH,
          TEST_DIFFICULTY_FACTORS,
          1
        )
        .accounts({
          user: u.kp.publicKey,
          agtAttestation: u.agtPda,
          vaultConfig: vaultConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([u.kp])
        .rpc();

      // JTX ATA + balance (skip mint if jtxAmount is null — used by
      // insufficientUser to assert the balance-too-low path).
      u.ata = await createAssociatedTokenAccountIdempotent(
        connection,
        founder,
        jtxMint,
        u.kp.publicKey,
        undefined,
        TOKEN_2022_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      if (jtxAmount) {
        await mintTo(
          connection,
          founder,
          jtxMint,
          u.ata,
          founder,
          BigInt(jtxAmount.toString()),
          [],
          undefined,
          TOKEN_2022_PROGRAM_ID
        );
      }
    };

    // Fund each user with exactly enough for their scenario.
    await setupUser(mojoUser, MOJO_THRESHOLD);
    await setupUser(insufficientUser, MOJO_THRESHOLD.divn(2)); // 6 JTX (< 12)
    await setupUser(earlyExitUser, MOJO_THRESHOLD);
    await setupUser(upgradeUser, DOJO_THRESHOLD); // enough for full DOJO upgrade
    await setupUser(cowboyUser, SPACE_COWBOY_THRESHOLD);
    await setupUser(deprecatedUser, MOJO_THRESHOLD);
  });

  // ─── Helper: build the standard StakeForTier accounts object ────────────────

  const stakeAccounts = (u: TierUser) => {
    const [stakePda] = getStakePositionPDA(u.kp.publicKey, programId);
    return {
      user: u.kp.publicKey,
      userJtxAta: u.ata,
      stakePosition: stakePda,
      stakeVaultAuthority: stakeVaultAuthorityPDA,
      stakeVaultAta,
      agtAttestation: u.agtPda,
      vaultConfig: vaultConfigPDA,
      jtxMint,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    };
  };

  // ========================================================================
  // (a) stake_for_tier — MOJO success path
  // ========================================================================

  it("(a) stake_for_tier MOJO success — locks 12 JTX, 1y expiry", async () => {
    await program.methods
      .stakeForTier(TIER_MOJO)
      .accounts(stakeAccounts(mojoUser))
      .signers([mojoUser.kp])
      .rpc();

    const [stakePda] = getStakePositionPDA(mojoUser.kp.publicKey, programId);
    const stake = await program.account.stakePosition.fetch(stakePda);

    expect(stake.owner.toBase58()).to.equal(mojoUser.kp.publicKey.toBase58());
    expect(stake.tier).to.equal(TIER_MOJO);
    expect(stake.amount.toString()).to.equal(MOJO_THRESHOLD.toString());
    expect(stake.status).to.equal(0);
    expect(stake.expiresAt.toNumber()).to.be.greaterThan(stake.stakedAt.toNumber());

    const agt = await program.account.agtAttestation.fetch(mojoUser.agtPda);
    expect(agt.subscriptionTier).to.equal(TIER_MOJO);
  });

  // ========================================================================
  // (b) stake_for_tier — insufficient JTX in user ATA
  // ========================================================================

  it("(b) stake_for_tier rejects when ATA balance < tier threshold", async () => {
    try {
      await program.methods
        .stakeForTier(TIER_MOJO)
        .accounts(stakeAccounts(insufficientUser))
        .signers([insufficientUser.kp])
        .rpc();
      expect.fail("Expected StakeBalanceTooLow");
    } catch (err: any) {
      expect(err.error?.errorCode?.code).to.equal("StakeBalanceTooLow");
    }
  });

  // ========================================================================
  // (c) unstake — pre-expiry reject
  // ========================================================================

  it("(c) unstake rejects before expires_at (StakeNotExpired)", async () => {
    // Stake first so we have an active position to unstake.
    await program.methods
      .stakeForTier(TIER_MOJO)
      .accounts(stakeAccounts(earlyExitUser))
      .signers([earlyExitUser.kp])
      .rpc();

    const [stakePda] = getStakePositionPDA(earlyExitUser.kp.publicKey, programId);

    try {
      await program.methods
        .unstake()
        .accounts({
          user: earlyExitUser.kp.publicKey,
          userJtxAta: earlyExitUser.ata,
          stakePosition: stakePda,
          stakeVaultAuthority: stakeVaultAuthorityPDA,
          stakeVaultAta,
          agtAttestation: earlyExitUser.agtPda,
          vaultConfig: vaultConfigPDA,
          jtxMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([earlyExitUser.kp])
        .rpc();
      expect.fail("Expected StakeNotExpired");
    } catch (err: any) {
      expect(err.error?.errorCode?.code).to.equal("StakeNotExpired");
    }
  });

  // ========================================================================
  // (d) unstake — post-expiry success  [SKIPPED]
  // ========================================================================

  it.skip("(d) unstake post-expiry success — covered separately in tests/stake-bankrun.ts", async () => {
    // Tier durations are 1y (MOJO) / 2y (DOJO). solana-test-validator can't
    // fast-forward clock, so this case is handled in a dedicated bankrun
    // test file (tests/stake-bankrun.ts) which uses ProgramTestContext.setClock()
    // to jump unix_timestamp past expires_at. Run via:
    //   npx ts-mocha -p ./tsconfig.json -t 1000000 tests/stake-bankrun.ts
    // 9 cases here on real-validator + 1 case there on bankrun = 10/10.
  });

  // ========================================================================
  // (e) restake_upgrade — MOJO → DOJO success
  // ========================================================================

  it("(e) restake_upgrade MOJO → DOJO success — transfers 432 JTX delta", async () => {
    // Initial stake at MOJO.
    await program.methods
      .stakeForTier(TIER_MOJO)
      .accounts(stakeAccounts(upgradeUser))
      .signers([upgradeUser.kp])
      .rpc();

    const [stakePda] = getStakePositionPDA(upgradeUser.kp.publicKey, programId);

    // Upgrade to DOJO.
    await program.methods
      .restakeUpgrade(TIER_DOJO)
      .accounts({
        user: upgradeUser.kp.publicKey,
        userJtxAta: upgradeUser.ata,
        stakePosition: stakePda,
        stakeVaultAuthority: stakeVaultAuthorityPDA,
        stakeVaultAta,
        agtAttestation: upgradeUser.agtPda,
        vaultConfig: vaultConfigPDA,
        jtxMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([upgradeUser.kp])
      .rpc();

    const stake = await program.account.stakePosition.fetch(stakePda);
    expect(stake.tier).to.equal(TIER_DOJO);
    expect(stake.amount.toString()).to.equal(DOJO_THRESHOLD.toString());

    const agt = await program.account.agtAttestation.fetch(upgradeUser.agtPda);
    expect(agt.subscriptionTier).to.equal(TIER_DOJO);
  });

  // ========================================================================
  // (f) restake_upgrade — downgrade rejected
  // ========================================================================

  it("(f) restake_upgrade rejects downgrade DOJO → MOJO (InvalidTierUpgrade)", async () => {
    const [stakePda] = getStakePositionPDA(upgradeUser.kp.publicKey, programId);

    try {
      await program.methods
        .restakeUpgrade(TIER_MOJO) // current is DOJO from case (e)
        .accounts({
          user: upgradeUser.kp.publicKey,
          userJtxAta: upgradeUser.ata,
          stakePosition: stakePda,
          stakeVaultAuthority: stakeVaultAuthorityPDA,
          stakeVaultAta,
          agtAttestation: upgradeUser.agtPda,
          vaultConfig: vaultConfigPDA,
          jtxMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([upgradeUser.kp])
        .rpc();
      expect.fail("Expected InvalidTierUpgrade");
    } catch (err: any) {
      expect(err.error?.errorCode?.code).to.equal("InvalidTierUpgrade");
    }
  });

  // ========================================================================
  // (g) SPACE COWBOY unstake — LifetimeStakePermanent reject
  // ========================================================================

  it("(g) SPACE COWBOY unstake rejected with LifetimeStakePermanent", async () => {
    // Stake at SPACE COWBOY tier — expires_at = 0.
    await program.methods
      .stakeForTier(TIER_SPACE_COWBOY)
      .accounts(stakeAccounts(cowboyUser))
      .signers([cowboyUser.kp])
      .rpc();

    const [stakePda] = getStakePositionPDA(cowboyUser.kp.publicKey, programId);
    const stake = await program.account.stakePosition.fetch(stakePda);
    expect(stake.expiresAt.toNumber()).to.equal(0); // LIFETIME_NEVER_EXPIRES

    // Attempt to unstake — must reject permanently.
    try {
      await program.methods
        .unstake()
        .accounts({
          user: cowboyUser.kp.publicKey,
          userJtxAta: cowboyUser.ata,
          stakePosition: stakePda,
          stakeVaultAuthority: stakeVaultAuthorityPDA,
          stakeVaultAta,
          agtAttestation: cowboyUser.agtPda,
          vaultConfig: vaultConfigPDA,
          jtxMint,
          tokenProgram: TOKEN_2022_PROGRAM_ID,
        })
        .signers([cowboyUser.kp])
        .rpc();
      expect.fail("Expected LifetimeStakePermanent");
    } catch (err: any) {
      expect(err.error?.errorCode?.code).to.equal("LifetimeStakePermanent");
    }
  });

  // ========================================================================
  // (h) deprecated set_subscription returns Deprecated
  // ========================================================================

  it("(h) set_subscription is deprecated — returns Deprecated error", async () => {
    try {
      await program.methods
        .setSubscription(TIER_MOJO, MOJO_THRESHOLD)
        .accounts({
          signer: founder.publicKey,
          agtAttestation: deprecatedUser.agtPda,
          vaultConfig: vaultConfigPDA,
        })
        .rpc();
      expect.fail("Expected Deprecated");
    } catch (err: any) {
      expect(err.error?.errorCode?.code).to.equal("Deprecated");
    }
  });

  // ========================================================================
  // (i) migrate_v2_thresholds — multisig reject path
  //     Happy-path skipped: see file header note.
  // ========================================================================

  it("(i) migrate_v2_thresholds rejects when multisig approval count < 2", async () => {
    // Caller is a registered multisig signer (founder), but no other signer
    // has approved → approval_count = 0 → MultisigNotApproved.
    // (We deliberately do NOT call set_paused here, since that resets
    // approvals on threshold and would either leave count=1 or trigger
    // pause + reset.)
    try {
      await program.methods
        .migrateV2Thresholds()
        .accounts({
          signer: founder.publicKey,
          vaultConfig: vaultConfigPDA,
        })
        .rpc();
      expect.fail("Expected MultisigNotApproved");
    } catch (err: any) {
      expect(err.error?.errorCode?.code).to.equal("MultisigNotApproved");
    }
  });

  it("(i-happy) migrate_v2_thresholds 2-of-3 happy path via approve_migrate_action × 2", async () => {
    // Pre-condition: mojoUser staked in case (a), so their AGT has
    // subscription_tier == 1 (set by stake_for_tier). After
    // approve_migrate_action × 2 + migrate_v2_thresholds, the
    // subscription_tier should be reset to 0 and mint_count_this_period to 0.
    const beforeAgt = await program.account.agtAttestation.fetch(mojoUser.agtPda)
    expect(beforeAgt.subscriptionTier).to.equal(1)

    // Two approvals — founder (default provider wallet) + multisigSigner2.
    await program.methods
      .approveMigrateAction()
      .accounts({ signer: founder.publicKey, vaultConfig: vaultConfigPDA })
      .rpc()
    await program.methods
      .approveMigrateAction()
      .accounts({ signer: multisigSigner2.publicKey, vaultConfig: vaultConfigPDA })
      .signers([multisigSigner2])
      .rpc()

    // Anyone in the multisig can now invoke migrate_v2_thresholds with the
    // target AGTs in remaining_accounts. The instruction iterates them
    // borsh-deserializing in place; we pass mojoUser's AGT.
    await program.methods
      .migrateV2Thresholds()
      .accounts({ signer: founder.publicKey, vaultConfig: vaultConfigPDA })
      .remainingAccounts([
        { pubkey: mojoUser.agtPda, isSigner: false, isWritable: true },
      ])
      .rpc()

    const afterAgt = await program.account.agtAttestation.fetch(mojoUser.agtPda)
    expect(afterAgt.subscriptionTier).to.equal(0)
    expect(afterAgt.mintCountThisPeriod).to.equal(0)
  })
})
