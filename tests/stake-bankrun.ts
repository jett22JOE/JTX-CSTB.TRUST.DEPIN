// ============================================================================
// JETT-VAULT v2.1 — Bankrun-only test for post-expiry unstake (case d)
// ============================================================================
// The mocha+real-validator suite at tests/stake-subsystem.ts covers 9 of the
// 10 B3.6 cases. The one it can't cover is post-expiry unstake success —
// MOJO tier expires 31,557,600 s (1 year) after staking, and
// solana-test-validator can't fast-forward clock. Bankrun can: setClock on
// the in-memory bank moves unix_timestamp arbitrarily, so the unstake's
// `clock.unix_timestamp >= stake_position.expires_at` check passes.
//
// This file is intentionally narrow — only case (d). Other cases stay on the
// existing real-validator suite.
//
// Run via:
//   npx ts-mocha -p ./tsconfig.json -t 1000000 tests/stake-bankrun.ts
// ============================================================================

import * as anchor from "@coral-xyz/anchor"
import { Program, BN } from "@coral-xyz/anchor"
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js"
import {
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  MINT_SIZE,
  createInitializeMint2Instruction,
} from "@solana/spl-token"
// spl-token-bankrun's helpers take a BanksClient instead of a Connection
// (BankrunProvider's wrapped connection has no .sendTransaction). Same
// signatures as @solana/spl-token otherwise — except `createMint` in
// 0.2.6 has a Token-2022 bug (hardcodes TOKEN_PROGRAM_ID as the new
// account's owner regardless of the programId arg). We hand-roll mint
// creation below; createAssociatedTokenAccount and mintTo are fine.
import {
  createAssociatedTokenAccount,
  mintTo,
} from "spl-token-bankrun"
import { startAnchor, Clock, type ProgramTestContext } from "solana-bankrun"
import type { BanksClient } from "solana-bankrun"
import { Transaction } from "@solana/web3.js"
import { BankrunProvider } from "anchor-bankrun"
import { expect } from "chai"
import { createHash } from "crypto"

import { JettVault } from "../target/types/jett_vault"

// ─── Constants (mirror tests/stake-subsystem.ts) ──────────────────────────────
const JTX_DECIMALS_RAW = new BN("1000000000")
const MOJO_THRESHOLD = JTX_DECIMALS_RAW.muln(12)
const MOJO_DURATION_SECONDS = 31_557_600  // shared::MOJO_DURATION_SECONDS

const TIER_MOJO = 1

const GOAL_LAMPORTS = new BN(5_874).mul(new BN(LAMPORTS_PER_SOL))
const TEST_GAZE_TENSOR = [new BN(400_000), new BN(350_000), new BN(250_000)]
const TEST_SESSION_SEED = [new BN(333_333), new BN(333_334), new BN(333_333)]
const TEST_DIFFICULTY_FACTORS = [new BN(500_000), new BN(300_000), new BN(200_000)]
const TEST_BIOMETRIC_PROOF_HASH = Array.from(
  createHash("sha256").update(Buffer.from("bankrun-post-expiry-v1")).digest()
)

const VAULT_PROGRAM_ID = new PublicKey(
  "JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7"
)

const seed = (s: string) => Buffer.from(s)
const findVaultConfigPda = () =>
  PublicKey.findProgramAddressSync([seed("vault_config")], VAULT_PROGRAM_ID)[0]
const findAgtAttestationPda = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("agt_attestation"), owner.toBuffer()], VAULT_PROGRAM_ID)[0]
const findStakePositionPda = (owner: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("stake"), owner.toBuffer()], VAULT_PROGRAM_ID)[0]
const findStakeVaultAuthorityPda = (vaultConfig: PublicKey) =>
  PublicKey.findProgramAddressSync([seed("stake_vault_authority"), vaultConfig.toBuffer()], VAULT_PROGRAM_ID)[0]

// ─── Token-2022 mint creation helper (bankrun-aware) ─────────────────────────
// Standalone replacement for spl-token-bankrun's createMint, which hardcodes
// the new mint account's owner to TOKEN_PROGRAM_ID (legacy SPL Token). Here
// we make sure the owner matches the program that will run InitializeMint2.
async function createToken2022Mint(
  banksClient: BanksClient,
  payer: Keypair,
  mintKeypair: Keypair,
  mintAuthority: PublicKey,
  decimals: number
): Promise<PublicKey> {
  const rent = await banksClient.getRent()
  const lamports = Number(await rent.minimumBalance(BigInt(MINT_SIZE)))
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: MINT_SIZE,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    }),
    createInitializeMint2Instruction(
      mintKeypair.publicKey,
      decimals,
      mintAuthority,
      null,
      TOKEN_2022_PROGRAM_ID
    )
  )
  const [recentBlockhash] = await banksClient.getLatestBlockhash()
  tx.recentBlockhash = recentBlockhash
  tx.sign(payer, mintKeypair)
  await banksClient.processTransaction(tx)
  return mintKeypair.publicKey
}

// ============================================================================

describe("jett-vault v2.1 — bankrun post-expiry unstake (case d)", function () {
  this.timeout(60_000)

  let context: ProgramTestContext
  let provider: BankrunProvider
  let program: Program<JettVault>

  // Test fixture wallets — fresh keypairs, funded via bankrun's setAccount.
  const founder = Keypair.generate()
  const multisigSigner2 = Keypair.generate()
  const multisigSigner3 = Keypair.generate()
  const earlyExitUser = Keypair.generate()

  let jtxMint: PublicKey
  let vaultConfigPDA: PublicKey
  let stakeVaultAuthorityPDA: PublicKey
  let stakeVaultAta: PublicKey
  let userJtxAta: PublicKey
  let agtPda: PublicKey
  let stakePositionPda: PublicKey

  before(async () => {
    // startAnchor loads target/deploy/jett_vault.so under the program ID
    // we declare. Pass empty programs/accounts arrays — the SDK auto-loads
    // from Anchor.toml / target/deploy.
    context = await startAnchor(
      "/Users/jettoptx/OPTX/astroknots-stack/jettoptx-poa-depin",
      [{ name: "jett_vault", programId: VAULT_PROGRAM_ID }],
      [
        // Pre-fund our test wallets with 100 SOL each.
        {
          address: founder.publicKey,
          info: {
            lamports: 100 * LAMPORTS_PER_SOL,
            data: Buffer.alloc(0),
            owner: SystemProgram.programId,
            executable: false,
          },
        },
        {
          address: multisigSigner2.publicKey,
          info: {
            lamports: 10 * LAMPORTS_PER_SOL,
            data: Buffer.alloc(0),
            owner: SystemProgram.programId,
            executable: false,
          },
        },
        {
          address: multisigSigner3.publicKey,
          info: {
            lamports: 10 * LAMPORTS_PER_SOL,
            data: Buffer.alloc(0),
            owner: SystemProgram.programId,
            executable: false,
          },
        },
        {
          address: earlyExitUser.publicKey,
          info: {
            lamports: 10 * LAMPORTS_PER_SOL,
            data: Buffer.alloc(0),
            owner: SystemProgram.programId,
            executable: false,
          },
        },
      ]
    )
    provider = new BankrunProvider(context, new anchor.Wallet(founder))
    anchor.setProvider(provider)
    program = new Program<JettVault>(
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      require("../target/idl/jett_vault.json"),
      provider
    )

    vaultConfigPDA = findVaultConfigPda()
    stakeVaultAuthorityPDA = findStakeVaultAuthorityPda(vaultConfigPDA)
    agtPda = findAgtAttestationPda(earlyExitUser.publicKey)
    stakePositionPda = findStakePositionPda(earlyExitUser.publicKey)

    // Initialize vault with our 3 multisig signers.
    const now = Math.floor(Date.now() / 1000)
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
      .rpc()

    // Create mock JTX mint (Token-2022, 9 decimals, founder = mint authority).
    // Hand-rolled because spl-token-bankrun@0.2.6's createMint has a
    // Token-2022 owner-mismatch bug (see comment near imports).
    jtxMint = await createToken2022Mint(
      context.banksClient,
      founder,
      Keypair.generate(),
      founder.publicKey,
      9
    )

    // Compute the stake_vault_ata canonical address (Token-2022).
    stakeVaultAta = getAssociatedTokenAddressSync(
      jtxMint,
      stakeVaultAuthorityPDA,
      true,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )

    // Set up earlyExitUser: AGT attestation + JTX ATA + JTX balance.
    await program.methods
      .createAgtAttestation(
        TEST_GAZE_TENSOR,
        TEST_SESSION_SEED,
        TEST_BIOMETRIC_PROOF_HASH,
        TEST_DIFFICULTY_FACTORS,
        1
      )
      .accounts({
        user: earlyExitUser.publicKey,
        agtAttestation: agtPda,
        vaultConfig: vaultConfigPDA,
        systemProgram: SystemProgram.programId,
      })
      .signers([earlyExitUser])
      .rpc()

    userJtxAta = await createAssociatedTokenAccount(
      context.banksClient,
      founder,
      jtxMint,
      earlyExitUser.publicKey,
      TOKEN_2022_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    )
    await mintTo(
      context.banksClient,
      founder,
      jtxMint,
      userJtxAta,
      founder,
      BigInt(MOJO_THRESHOLD.toString()),
      [],
      TOKEN_2022_PROGRAM_ID
    )

    // Stake MOJO. After this, stake_position has expires_at = staked_at +
    // 31_557_600 s. The wall clock is roughly `now`, so expires_at ≈
    // now + 1 year.
    await program.methods
      .stakeForTier(TIER_MOJO)
      .accounts({
        user: earlyExitUser.publicKey,
        userJtxAta,
        stakePosition: stakePositionPda,
        stakeVaultAuthority: stakeVaultAuthorityPDA,
        stakeVaultAta,
        agtAttestation: agtPda,
        vaultConfig: vaultConfigPDA,
        jtxMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([earlyExitUser])
      .rpc()
  })

  // ──────────────────────────────────────────────────────────────────────────
  // (d) unstake post-expiry SUCCESS — uses bankrun setClock to fast-forward
  // ──────────────────────────────────────────────────────────────────────────
  it("(d) unstake post-expiry success — setClock jumps past expires_at", async () => {
    // Confirm pre-expiry: clock < expires_at, unstake should fail.
    const stakeBefore = await program.account.stakePosition.fetch(stakePositionPda)
    expect(stakeBefore.tier).to.equal(TIER_MOJO)
    expect(stakeBefore.amount.toString()).to.equal(MOJO_THRESHOLD.toString())
    expect(stakeBefore.status).to.equal(0)
    expect(stakeBefore.expiresAt.toNumber()).to.be.greaterThan(
      stakeBefore.stakedAt.toNumber()
    )

    // Fast-forward the on-chain clock to one second AFTER expires_at.
    const currentClock = await context.banksClient.getClock()
    const targetUnix =
      BigInt(stakeBefore.expiresAt.toNumber()) + 1n
    const newClock = new Clock(
      currentClock.slot,
      currentClock.epochStartTimestamp,
      currentClock.epoch,
      currentClock.leaderScheduleEpoch,
      targetUnix
    )
    context.setClock(newClock)

    // Unstake should now succeed (clock.unix_timestamp >= expires_at).
    await program.methods
      .unstake()
      .accounts({
        user: earlyExitUser.publicKey,
        userJtxAta,
        stakePosition: stakePositionPda,
        stakeVaultAuthority: stakeVaultAuthorityPDA,
        stakeVaultAta,
        agtAttestation: agtPda,
        vaultConfig: vaultConfigPDA,
        jtxMint,
        tokenProgram: TOKEN_2022_PROGRAM_ID,
      })
      .signers([earlyExitUser])
      .rpc()

    // The StakePosition is closed by `close = user` in the Unstake context;
    // fetching the account should now fail.
    let closed = false
    try {
      await program.account.stakePosition.fetch(stakePositionPda)
    } catch {
      closed = true
    }
    expect(closed).to.equal(true)
  })
})
