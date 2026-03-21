/**
 * JTX Vault — Devnet Integration Test
 * =====================================
 * Tests: initialize_vault → donate_sol → mint_donor_nft
 * 
 * Run: npx ts-node tests/test_vault_flow.ts
 * Requires: @coral-xyz/anchor, @solana/web3.js
 */

import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";

// Program ID (deployed on devnet)
const PROGRAM_ID = new PublicKey("JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7");

// Multisig signers (founder + JOE + placeholder for 2-of-3)
const FOUNDER = new PublicKey("FEUwuvXbbSYTCEhhqgAt2viTsEnromNNDsapoFvyfy3H");
const JOE_WALLET = new PublicKey("EFvgELE1Hb4PC5tbPTAe8v1uEDGee8nwYBMCU42bZRGk");
const PLACEHOLDER = new PublicKey("11111111111111111111111111111111"); // System program as 3rd

async function main() {
  // Setup
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const idl = await Program.fetchIdl(PROGRAM_ID, provider);
  if (!idl) throw new Error("IDL not found — did you deploy with anchor build (not --no-idl)?");
  const program = new Program(idl, PROGRAM_ID, provider);

  const wallet = provider.wallet.publicKey;
  console.log("=== JTX VAULT DEVNET TEST ===");
  console.log("Wallet:", wallet.toBase58());
  console.log("Program:", PROGRAM_ID.toBase58());
  console.log("Balance:", (await provider.connection.getBalance(wallet)) / LAMPORTS_PER_SOL, "SOL");

  // ─── Derive PDAs ───
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_config")],
    PROGRAM_ID
  );
  console.log("Vault PDA:", vaultPda.toBase58());

  const [donorPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("donor"), wallet.toBuffer()],
    PROGRAM_ID
  );
  console.log("Donor PDA:", donorPda.toBase58());

  // ─── Test 1: Initialize Vault ───
  console.log("\n--- TEST 1: initialize_vault ---");
  try {
    const now = Math.floor(Date.now() / 1000);
    const phase1Deadline = new anchor.BN(now + 86400 * 10);  // 10 days
    const phase2Deadline = new anchor.BN(now + 86400 * 90);  // 90 days
    const goalLamports = new anchor.BN(5_874 * LAMPORTS_PER_SOL); // 5874 SOL

    const tx = await program.methods
      .initializeVault(
        goalLamports,
        phase1Deadline,
        phase2Deadline,
        [FOUNDER, JOE_WALLET, PLACEHOLDER]
      )
      .accounts({
        founder: wallet,
        vaultConfig: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Vault initialized! TX:", tx);
  } catch (e: any) {
    if (e.message?.includes("already in use")) {
      console.log("⏭️  Vault already initialized (PDA exists)");
    } else {
      console.error("❌ Initialize failed:", e.message || e);
    }
  }

  // ─── Fetch vault state ───
  try {
    const vault = await program.account.vaultConfig.fetch(vaultPda);
    console.log("Vault state:", {
      authority: vault.authority.toBase58(),
      goal: vault.goalLamports.toNumber() / LAMPORTS_PER_SOL + " SOL",
      raised: vault.raisedLamports.toNumber() / LAMPORTS_PER_SOL + " SOL",
      phase: vault.phase,
      donors: vault.donorCount,
      launched: vault.isLaunched,
    });
  } catch (e: any) {
    console.error("Could not fetch vault:", e.message);
  }

  // ─── Test 2: Donate SOL ───
  console.log("\n--- TEST 2: donate_sol (0.01 SOL) ---");
  try {
    const donateAmount = new anchor.BN(0.01 * LAMPORTS_PER_SOL); // 0.01 SOL

    const tx = await program.methods
      .donateSol(donateAmount, null) // no referrer
      .accounts({
        donorSigner: wallet,
        donor: donorPda,
        vaultConfig: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✅ Donation successful! TX:", tx);
  } catch (e: any) {
    console.error("❌ Donate failed:", e.message || e);
  }

  // ─── Fetch donor state ───
  try {
    const donor = await program.account.donor.fetch(donorPda);
    console.log("Donor state:", {
      wallet: donor.wallet.toBase58(),
      deposited: donor.amountLamports.toNumber() / LAMPORTS_PER_SOL + " SOL",
      multiplier: donor.optxMultiplierBps + " bps",
      attested: donor.attested,
      nftMinted: donor.nftMinted,
    });
  } catch (e: any) {
    console.error("Could not fetch donor:", e.message);
  }

  // ─── Test 3: Mint Donor NFT Receipt ───
  console.log("\n--- TEST 3: mint_donor_nft ---");
  const [receiptPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), vaultPda.toBuffer(), wallet.toBuffer()],
    PROGRAM_ID
  );
  console.log("Receipt PDA:", receiptPda.toBase58());

  try {
    const solPriceUsdc = new anchor.BN(133_000_000); // $133 per SOL

    const tx = await program.methods
      .mintDonorNft(solPriceUsdc)
      .accounts({
        donorSigner: wallet,
        donor: donorPda,
        donorReceipt: receiptPda,
        vaultConfig: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✅ NFT Receipt minted! TX:", tx);
  } catch (e: any) {
    console.error("❌ NFT mint failed:", e.message || e);
  }

  // ─── Fetch receipt state ───
  try {
    const receipt = await program.account.donorReceipt.fetch(receiptPda);
    console.log("Receipt state:", {
      donor: receipt.donor.toBase58(),
      donationUsdc: "$" + (receipt.donationValueUsdc.toNumber() / 1_000_000).toFixed(2),
      jtxEntitled: (receipt.jtxEntitled.toNumber() / 1_000_000_000).toFixed(4) + " JTX",
      solPrice: "$" + (receipt.solPriceUsdc.toNumber() / 1_000_000).toFixed(2),
      multiplier: receipt.multiplierBps + " bps",
      claimed: receipt.claimed,
      paymentMethod: receipt.paymentMethod === 0 ? "SOL" : "USDC/agent",
    });
  } catch (e: any) {
    console.error("Could not fetch receipt:", e.message);
  }

  // ─── Final balances ───
  console.log("\n--- FINAL STATE ---");
  console.log("Wallet balance:", (await provider.connection.getBalance(wallet)) / LAMPORTS_PER_SOL, "SOL");
  console.log("Vault balance:", (await provider.connection.getBalance(vaultPda)) / LAMPORTS_PER_SOL, "SOL");
  console.log("\n=== TEST COMPLETE ===");
}

main().catch(console.error);
