/**
 * JTX Vault — Devnet Integration Test (Raw RPC, no IDL required)
 * ================================================================
 * Tests: initialize_vault → donate_sol → mint_donor_nft
 *
 * Run: npx ts-node tests/test_vault_flow.ts
 */

import {
  Connection,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  Keypair,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// ─── Config ───
const PROGRAM_ID = new PublicKey("JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7");
const RPC_URL = process.env.ANCHOR_PROVIDER_URL || `https://devnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY || ""}`;
const WALLET_PATH = process.env.ANCHOR_WALLET || `${process.env.HOME}/.config/solana/id.json`;

// Known addresses
const FOUNDER = new PublicKey("FEUwuvXbbSYTCEhhqgAt2viTsEnromNNDsapoFvyfy3H");
const JOE_WALLET = new PublicKey("EFvgELE1Hb4PC5tbPTAe8v1uEDGee8nwYBMCU42bZRGk");
const PLACEHOLDER = new PublicKey("11111111111111111111111111111111");

// ─── Anchor Sighash (first 8 bytes of sha256("global:<name>")) ───
const { createHash } = require("crypto");
function sighash(name: string): Buffer {
  const hash = createHash("sha256").update(`global:${name}`).digest();
  return hash.slice(0, 8);
}

// ─── Helpers ───
function loadKeypair(filepath: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(filepath, "utf-8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function encodeBN(value: bigint, bytes: number = 8): Buffer {
  const buf = Buffer.alloc(bytes);
  buf.writeBigUInt64LE(value);
  return buf;
}

function encodeI64(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(value);
  return buf;
}

function encodePubkeyArray(keys: PublicKey[]): Buffer {
  return Buffer.concat(keys.map((k) => k.toBuffer()));
}

async function main() {
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = loadKeypair(WALLET_PATH);
  const walletPubkey = wallet.publicKey;

  console.log("=== JTX VAULT DEVNET TEST (raw RPC) ===");
  console.log("Wallet:", walletPubkey.toBase58());
  console.log("Program:", PROGRAM_ID.toBase58());
  console.log("RPC: [configured]");
  const bal = await connection.getBalance(walletPubkey);
  console.log("Balance:", bal / LAMPORTS_PER_SOL, "SOL");

  // ─── Derive PDAs ───
  const [vaultPda, vaultBump] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_config")],
    PROGRAM_ID
  );
  console.log("Vault PDA:", vaultPda.toBase58());

  const [donorPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("donor"), walletPubkey.toBuffer()],
    PROGRAM_ID
  );
  console.log("Donor PDA:", donorPda.toBase58());

  const [receiptPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), vaultPda.toBuffer(), walletPubkey.toBuffer()],
    PROGRAM_ID
  );
  console.log("Receipt PDA:", receiptPda.toBase58());

  // ─── Test 1: initialize_vault ───
  console.log("\n--- TEST 1: initialize_vault ---");
  try {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const phase1Deadline = now + 86400n * 10n;  // 10 days
    const phase2Deadline = now + 86400n * 90n;  // 90 days
    const goalLamports = 5874n * BigInt(LAMPORTS_PER_SOL);

    const data = Buffer.concat([
      sighash("initialize_vault"),
      encodeBN(goalLamports),
      encodeI64(phase1Deadline),
      encodeI64(phase2Deadline),
      encodePubkeyArray([FOUNDER, JOE_WALLET, PLACEHOLDER]),
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: walletPubkey, isSigner: true, isWritable: true },  // founder
        { pubkey: vaultPda, isSigner: false, isWritable: true },      // vault_config
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log("✅ Vault initialized! TX:", sig);
  } catch (e: any) {
    if (e.message?.includes("already in use")) {
      console.log("⏭️  Vault already initialized (PDA exists)");
    } else {
      console.error("❌ Initialize failed:", e.message?.slice(0, 200) || e);
    }
  }

  // ─── Check vault account exists ───
  const vaultInfo = await connection.getAccountInfo(vaultPda);
  console.log("Vault account:", vaultInfo ? `${vaultInfo.data.length} bytes, ${vaultInfo.lamports / LAMPORTS_PER_SOL} SOL` : "NOT FOUND");

  // ─── Test 2: donate_sol (0.01 SOL) ───
  console.log("\n--- TEST 2: donate_sol (0.01 SOL) ---");
  try {
    const amount = BigInt(0.01 * LAMPORTS_PER_SOL);

    // Encode: amount (u64) + referrer (Option<Pubkey> = None = 0 byte)
    const data = Buffer.concat([
      sighash("donate_sol"),
      encodeBN(amount),
      Buffer.from([0]), // None referrer
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: walletPubkey, isSigner: true, isWritable: true },   // donor_signer
        { pubkey: donorPda, isSigner: false, isWritable: true },       // donor
        { pubkey: vaultPda, isSigner: false, isWritable: true },       // vault_config
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log("✅ Donated 0.01 SOL! TX:", sig);
  } catch (e: any) {
    console.error("❌ Donate failed:", e.message?.slice(0, 300) || e);
  }

  // ─── Check donor account ───
  const donorInfo = await connection.getAccountInfo(donorPda);
  console.log("Donor account:", donorInfo ? `${donorInfo.data.length} bytes` : "NOT FOUND");

  // ─── Test 3: mint_donor_nft ───
  console.log("\n--- TEST 3: mint_donor_nft ---");
  try {
    const solPriceUsdc = 133_000_000n; // $133

    const data = Buffer.concat([
      sighash("mint_donor_nft"),
      encodeBN(solPriceUsdc),
    ]);

    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: walletPubkey, isSigner: true, isWritable: true },    // donor_signer
        { pubkey: donorPda, isSigner: false, isWritable: true },        // donor
        { pubkey: receiptPda, isSigner: false, isWritable: true },      // donor_receipt
        { pubkey: vaultPda, isSigner: false, isWritable: false },       // vault_config
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });

    const tx = new Transaction().add(ix);
    const sig = await sendAndConfirmTransaction(connection, tx, [wallet]);
    console.log("✅ NFT Receipt minted! TX:", sig);
  } catch (e: any) {
    console.error("❌ NFT mint failed:", e.message?.slice(0, 300) || e);
  }

  // ─── Check receipt account ───
  const receiptInfo = await connection.getAccountInfo(receiptPda);
  console.log("Receipt account:", receiptInfo ? `${receiptInfo.data.length} bytes` : "NOT FOUND");

  // ─── Final state ───
  console.log("\n--- FINAL STATE ---");
  console.log("Wallet:", (await connection.getBalance(walletPubkey)) / LAMPORTS_PER_SOL, "SOL");
  console.log("Vault PDA:", vaultInfo ? (await connection.getBalance(vaultPda)) / LAMPORTS_PER_SOL + " SOL" : "N/A");
  console.log("\n=== TEST COMPLETE ===");
  console.log("View on Solscan: https://solscan.io/account/" + PROGRAM_ID.toBase58() + "?cluster=devnet");
}

main().catch(console.error);
