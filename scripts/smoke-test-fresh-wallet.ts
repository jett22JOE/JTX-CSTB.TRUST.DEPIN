/**
 * Fresh-wallet end-to-end smoke test against deployed v2.1 on devnet.
 *
 * Generates a new keypair, funds it from the founder wallet, bootstraps
 * AGT + AARON audit, then exercises donate_sol → mint_donor_nft.
 *
 * Proves the entire stack works AS-DEPLOYED for a brand-new wallet.
 *
 * Usage:
 *   ts-node --transpile-only scripts/smoke-test-fresh-wallet.ts
 */

import { Program, AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as crypto from "crypto";

const PROGRAM_ID = new PublicKey("JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7");
const PYTH_SOL_USD_FEED_ID =
  "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const HERMES_BASE = "https://hermes.pyth.network";

const GAZE_TENSOR = [333_333n, 333_333n, 333_334n];
const SESSION_SEED = [100_000n, 200_000n, 300_000n];
const DIFFICULTY_FACTORS = [100_000n, 100_000n, 100_000n];

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

function anchorSighash(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().slice(0, 8);
}

function encodeU64LE(v: bigint): Buffer {
  const buf = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) { buf[i] = Number(v & 0xffn); v >>= 8n; }
  return buf;
}

async function fetchPythUpdate(): Promise<string> {
  const id = PYTH_SOL_USD_FEED_ID.replace(/^0x/, "");
  // pyth-solana-receiver@0.14 SDK does Buffer.from(data, "base64") — so we
  // MUST request base64. Hermes default with encoding omitted is hex now,
  // so pin it explicitly.
  const res = await fetch(`${HERMES_BASE}/v2/updates/price/latest?ids[]=${id}&encoding=base64`);
  if (!res.ok) throw new Error(`Hermes ${res.status}`);
  const body: any = await res.json();
  console.log(`     [debug] Hermes encoding=${body.binary?.encoding}, data len=${body.binary?.data?.[0]?.length}`);
  return body.binary.data[0];
}

async function main() {
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const founder = loadKeypair("/Users/jettoptx/OPTX/founder-wallet-keypair.json");
  const deployer = loadKeypair("/Users/jettoptx/.config/solana/id.json");

  // Resume mode: --resume <path> uses an existing keypair (skips earlier
  // steps automatically via PDA existence checks). Otherwise generates fresh.
  const resumeIdx = process.argv.indexOf("--resume");
  let testWallet: Keypair;
  if (resumeIdx >= 0 && process.argv[resumeIdx + 1]) {
    testWallet = loadKeypair(process.argv[resumeIdx + 1]);
    console.log("Resuming with wallet:", testWallet.publicKey.toBase58());
  } else {
    testWallet = Keypair.generate();
    console.log("Fresh test wallet:", testWallet.publicKey.toBase58());
    const savePath = `/Users/jettoptx/OPTX/devnet-smoke-${Date.now()}.json`;
    fs.writeFileSync(savePath, JSON.stringify(Array.from(testWallet.secretKey)));
    console.log("Saved to:", savePath);
  }

  // ─── Step 0: fund (skip if already has > 0.1 SOL) ────────────────────────
  const bal = await conn.getBalance(testWallet.publicKey, "confirmed");
  if (bal < 0.1 * LAMPORTS_PER_SOL) {
    console.log("\n[0/4] Funding test wallet with 0.3 SOL from founder…");
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: founder.publicKey,
        toPubkey: testWallet.publicKey,
        lamports: 0.3 * LAMPORTS_PER_SOL,
      })
    );
    const fundSig = await sendAndConfirmTransaction(conn, fundTx, [founder]);
    console.log("     sig:", fundSig);
  } else {
    console.log(`\n[0/4] Test wallet already funded (${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL).`);
  }

  // PDAs
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault_config")], PROGRAM_ID);
  const [donorPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("donor"), testWallet.publicKey.toBuffer()], PROGRAM_ID
  );
  const [receiptPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), vaultPda.toBuffer(), testWallet.publicKey.toBuffer()], PROGRAM_ID
  );
  const [agtPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("agt_attestation"), testWallet.publicKey.toBuffer()], PROGRAM_ID
  );
  const [auditPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("aaron_audit"), agtPda.toBuffer()], PROGRAM_ID
  );

  const idl = JSON.parse(fs.readFileSync("./target/idl/jett_vault.json", "utf8"));
  const userProvider = new AnchorProvider(conn, new Wallet(testWallet), { commitment: "confirmed" });
  const userProgram: any = new Program(idl, userProvider);
  const deployerProvider = new AnchorProvider(conn, new Wallet(deployer), { commitment: "confirmed" });
  const deployerProgram: any = new Program(idl, deployerProvider);

  // ─── Step 1: create_agt_attestation (skip if exists) ─────────────────────
  const agtExisting = await conn.getAccountInfo(agtPda, "confirmed");
  if (agtExisting) {
    console.log("\n[1/4] AGT attestation already exists — skipping.");
  } else {
  console.log("\n[1/4] Creating AGT attestation for test wallet…");
  const biometricHash = crypto.createHash("sha256")
    .update(testWallet.publicKey.toBuffer())
    .update("smoke-test-2026-05-10")
    .digest();
  const agtSig = await userProgram.methods
    .createAgtAttestation(
      GAZE_TENSOR.map(n => new BN(n.toString())),
      SESSION_SEED.map(n => new BN(n.toString())),
      Array.from(biometricHash),
      DIFFICULTY_FACTORS.map(n => new BN(n.toString())),
      0
    )
    .accounts({
      user: testWallet.publicKey,
      agtAttestation: agtPda,
      vaultConfig: vaultPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: "confirmed" });
  console.log("     sig:", agtSig);
  }

  // ─── Step 2: aaron_audit (skip if exists) ────────────────────────────────
  const auditExisting = await conn.getAccountInfo(auditPda, "confirmed");
  if (auditExisting) {
    console.log("\n[2/4] AARON audit already exists — skipping. (Note: ≤ 5 min staleness rule applies.)");
  } else {
  console.log("\n[2/4] Creating AARON audit (deployer signs as operator)…");
  const auditHash = crypto.createHash("sha256").update(agtPda.toBuffer()).update("audit").digest();
  const notesHash = crypto.createHash("sha256").update("smoke-test").digest();
  const auditSig = await deployerProgram.methods
    .aaronAudit(
      Array.from(auditHash),
      100, 100, 100, 100,
      Array.from(notesHash)
    )
    .accounts({
      aaronOperator: deployer.publicKey,
      agtAttestation: agtPda,
      aaronAuditAccount: auditPda,
      vaultConfig: vaultPda,
      systemProgram: SystemProgram.programId,
    })
    .rpc({ commitment: "confirmed" });
  console.log("     sig:", auditSig);
  }

  // ─── Step 3: donate_sol (skip if donor PDA exists) ───────────────────────
  const donorExisting = await conn.getAccountInfo(donorPda, "confirmed");
  if (donorExisting) {
    console.log("\n[3/4] donor PDA already exists — donate_sol previously confirmed.");
  } else {
  console.log("\n[3/4] donate_sol — 0.05 SOL from test wallet…");
  const donateData = Buffer.concat([
    anchorSighash("donate_sol"),
    encodeU64LE(50_000_000n),  // 0.05 SOL
    Buffer.from([0]),           // None referrer
  ]);
  const donateTx = new Transaction().add(
    new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: testWallet.publicKey, isSigner: true, isWritable: true },
        { pubkey: donorPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: donateData,
    })
  );
  const donateSig = await sendAndConfirmTransaction(conn, donateTx, [testWallet]);
  console.log("     sig:", donateSig);
  }

  // ─── Step 4: mint_donor_nft via Pyth Solana Receiver SDK ─────────────────
  console.log("\n[4/4] mint_donor_nft (with fresh Pyth SOL/USD update)…");
  const { PythSolanaReceiver } = await import(
    "/Users/jettoptx/OPTX/joe-jettopics-saas/node_modules/@pythnetwork/pyth-solana-receiver"
  );
  const receiver = new (PythSolanaReceiver as any)({
    connection: conn,
    wallet: userProvider.wallet,
  });
  const txBuilder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });

  const updateData = await fetchPythUpdate();
  await txBuilder.addPostPriceUpdates([updateData]);

  await txBuilder.addPriceConsumerInstructions(async (getPriceUpdateAccount: (feedId: string) => PublicKey) => {
    const priceUpdatePda = getPriceUpdateAccount(PYTH_SOL_USD_FEED_ID);
    const mintIx = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: testWallet.publicKey, isSigner: true, isWritable: true },
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

  // ─── Decode the receipt ───────────────────────────────────────────────────
  console.log("\nDecoding receipt…");
  const r = await userProgram.account.donorReceipt.fetch(receiptPda);
  console.log("  donation_value_usdc:", (r.donationValueUsdc.toNumber() / 1_000_000).toFixed(2), "USD");
  console.log("  sol_price_usdc:     ", (r.solPriceUsdc.toNumber() / 1_000_000).toFixed(2), "USD/SOL (live Pyth)");
  console.log("  jtx_entitled:       ", (r.jtxEntitled.toNumber() / 1e9).toFixed(4), "JTX");
  console.log("  minted_at:          ", new Date(r.mintedAt.toNumber() * 1000).toISOString());
  console.log();
  console.log("✓ SMOKE TEST PASSED");
  console.log(`  receipt PDA: ${receiptPda.toBase58()}`);
  console.log(`  https://solscan.io/account/${receiptPda.toBase58()}?cluster=devnet`);
}

main().catch((err) => {
  console.error(err);
  if (err.logs) console.error("logs:", err.logs.slice(0, 30));
  process.exit(1);
});
