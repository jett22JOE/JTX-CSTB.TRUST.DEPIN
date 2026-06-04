/**
 * End-to-end devnet smoke test: donate_sol → mint_donor_nft.
 *
 * Proves the SOL→NFT-receipt flow at JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7
 * works on public devnet now that v2.1 + approve_migrate_action are deployed
 * and the founder wallet has bootstrap AGT + AARON audit.
 *
 * Usage:
 *   ts-node --transpile-only scripts/test-mint-nft-devnet.ts
 *
 * Configuration via env:
 *   DONATE_SOL=0.05  (default; ~$10 at $200/SOL — beats $8 NFT threshold)
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as fs from "fs";
import * as crypto from "crypto";

const PROGRAM_ID = new PublicKey(
  "JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7"
);

// Pyth Solana Receiver program ID + SOL/USD feed (Hermes / receiver-sdk format)
const PYTH_RECEIVER_ID = new PublicKey(
  "rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ"
);
const PYTH_SOL_USD_FEED_ID =
  "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const HERMES_BASE = "https://hermes.pyth.network";

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

function anchorSighash(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().slice(0, 8);
}

function encodeU64LE(v: bigint): Buffer {
  const buf = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) {
    buf[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return buf;
}

async function fetchPythUpdate(): Promise<string> {
  const id = PYTH_SOL_USD_FEED_ID.replace(/^0x/, "");
  const url = `${HERMES_BASE}/v2/updates/price/latest?ids[]=${id}`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Hermes ${res.status}`);
  const body: any = await res.json();
  return body.binary.data[0];
}

async function main() {
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const founder = loadKeypair("/Users/jettoptx/OPTX/founder-wallet-keypair.json");
  const provider = new AnchorProvider(conn, new Wallet(founder), { commitment: "confirmed" });

  const lamports = BigInt(Math.round(parseFloat(process.env.DONATE_SOL ?? "0.05") * LAMPORTS_PER_SOL));

  // PDAs
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault_config")], PROGRAM_ID);
  const [donorPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("donor"), founder.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const [receiptPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), vaultPda.toBuffer(), founder.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const [agtPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("agt_attestation"), founder.publicKey.toBuffer()],
    PROGRAM_ID
  );
  const [auditPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("aaron_audit"), agtPda.toBuffer()],
    PROGRAM_ID
  );

  console.log("Smoke test config");
  console.log("  donor:           ", founder.publicKey.toBase58());
  console.log("  vault_config:    ", vaultPda.toBase58());
  console.log("  donor_pda:       ", donorPda.toBase58());
  console.log("  donor_receipt:   ", receiptPda.toBase58());
  console.log("  agt_attestation: ", agtPda.toBase58());
  console.log("  aaron_audit:     ", auditPda.toBase58());
  console.log("  donate amount:   ", lamports, "lamports (", Number(lamports) / LAMPORTS_PER_SOL, "SOL)");
  console.log();

  // ─── Step 1: donate_sol ─────────────────────────────────────────────────
  const donorInfo = await conn.getAccountInfo(donorPda, "confirmed");
  if (!donorInfo) {
    console.log("[1/2] Calling donate_sol…");
    const data = Buffer.concat([
      anchorSighash("donate_sol"),
      encodeU64LE(lamports),
      Buffer.from([0]), // None referrer
    ]);
    const tx = new Transaction().add(
      new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: founder.publicKey, isSigner: true, isWritable: true },
          { pubkey: donorPda, isSigner: false, isWritable: true },
          { pubkey: vaultPda, isSigner: false, isWritable: true },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data,
      })
    );
    const sig = await provider.sendAndConfirm(tx, [founder]);
    console.log("     sig:", sig);
  } else {
    console.log("[1/2] donor PDA already exists — donate_sol previously confirmed.");
  }

  // ─── Step 2: mint_donor_nft via Pyth Solana Receiver SDK ────────────────
  const receiptInfo = await conn.getAccountInfo(receiptPda, "confirmed");
  if (receiptInfo) {
    console.log("\n[2/2] donor_receipt already exists — NFT was previously minted.");
    console.log("     receipt:", receiptPda.toBase58());
    return;
  }

  console.log("\n[2/2] Calling mint_donor_nft (with fresh Pyth update)…");
  // Lazy-require to keep this file ts-checkable without the optional dep at top.
  const { PythSolanaReceiver } = await import(
    "/Users/jettoptx/OPTX/joe-jettopics-saas/node_modules/@pythnetwork/pyth-solana-receiver"
  );

  const receiver = new (PythSolanaReceiver as any)({
    connection: conn,
    wallet: provider.wallet,
  });
  const txBuilder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });

  const updateData = await fetchPythUpdate();
  await txBuilder.addPostPriceUpdates([updateData]);

  await txBuilder.addPriceConsumerInstructions(async (getPriceUpdateAccount: (feedId: string) => PublicKey) => {
    const priceUpdatePda = getPriceUpdateAccount(PYTH_SOL_USD_FEED_ID);
    const mintIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: founder.publicKey, isSigner: true, isWritable: true },
        { pubkey: donorPda, isSigner: false, isWritable: true },
        { pubkey: receiptPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: false },
        { pubkey: agtPda, isSigner: false, isWritable: false },
        { pubkey: auditPda, isSigner: false, isWritable: false },
        { pubkey: priceUpdatePda, isSigner: false, isWritable: false },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: anchorSighash("mint_donor_nft"),
    });
    return [{ instruction: mintIx, signers: [] }];
  });

  const versionedTxs = await txBuilder.buildVersionedTransactions({
    computeUnitPriceMicroLamports: 100_000,
  });
  const sigs = await receiver.provider.sendAll(versionedTxs);
  console.log("     sigs:", sigs);

  console.log("\nMint complete.");
  console.log(`  Explorer: https://solscan.io/account/${receiptPda.toBase58()}?cluster=devnet`);
}

main().catch((err) => {
  console.error(err);
  if (err.logs) console.error("logs:", err.logs.slice(0, 30));
  process.exit(1);
});
