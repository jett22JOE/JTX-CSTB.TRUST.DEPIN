/**
 * B3.10 end-to-end CLI mint: donate_sol → mint_donor_nft (with mpl-core CPI).
 *
 * Proves the new wallet-visible NFT flow works against the deployed
 * devnet program CFXw63o3bH6mRHukLF495rKaU1bp5eqbnyVT3xNFitsz with the
 * full Pyth + AGT + AARON audit + mpl-core CreateV2 pipeline.
 *
 * The browser-side hit "TypeError: Failed to fetch" on a roundtrip we
 * can't easily inspect; this CLI reproducer eliminates browser variables
 * (CORS, edge cache, wallet adapter, RPC quirks) so we can confirm the
 * on-chain contract is what we think it is.
 *
 * Usage:
 *   ts-node --transpile-only scripts/mint-b310-nft.ts
 *
 * Env:
 *   WALLET=/path/to/keypair.json      defaults to ~/OPTX/founder-wallet-keypair.json
 *   DONATE_SOL=0.1                    only used if donor PDA doesn't exist yet
 */

import {
  AddressLookupTableAccount,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  VersionedTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as crypto from "crypto";

const PROGRAM_ID = new PublicKey("CFXw63o3bH6mRHukLF495rKaU1bp5eqbnyVT3xNFitsz");
const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");
const PYTH_SOL_USD_FEED_ID =
  "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const HERMES_BASE = "https://hermes.pyth.network";
const RPC_URL = "https://api.devnet.solana.com";

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
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
  const url = `${HERMES_BASE}/v2/updates/price/latest?ids[]=${id}&encoding=base64`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`Hermes ${res.status}`);
  const body: any = await res.json();
  return body.binary.data[0];
}

async function refreshAaronAudit(wallet: string): Promise<void> {
  const res = await fetch("https://aaron.jettoptics.ai/audit/devnet", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ user_wallet: wallet }),
  });
  if (!res.ok) throw new Error(`AARON ${res.status}: ${await res.text()}`);
  const j = (await res.json()) as { sig: string; action: string };
  console.log(`  [aaron] audit ${j.action} (${j.sig.slice(0, 16)}…)`);
}

async function main() {
  const conn = new Connection(RPC_URL, "confirmed");
  const walletPath = process.env.WALLET ?? `${process.env.HOME}/OPTX/founder-wallet-keypair.json`;
  const user = loadKeypair(walletPath);
  console.log("Signer:", user.publicKey.toBase58());

  // ─── PDAs ────────────────────────────────────────────────────────────────
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault_config")], PROGRAM_ID);
  const [donorPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("donor"), user.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  const [receiptPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("receipt"), vaultPda.toBuffer(), user.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  const [agtPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("agt_attestation"), user.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  const [auditPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("aaron_audit"), agtPda.toBuffer()],
    PROGRAM_ID,
  );

  console.log("PDAs:");
  console.log("  vault:   ", vaultPda.toBase58());
  console.log("  donor:   ", donorPda.toBase58());
  console.log("  receipt: ", receiptPda.toBase58());
  console.log("  agt:     ", agtPda.toBase58());
  console.log("  audit:   ", auditPda.toBase58());

  // ─── Step 1: donate_sol (if needed) ──────────────────────────────────────
  const donorInfo = await conn.getAccountInfo(donorPda, "confirmed");
  if (!donorInfo) {
    const lamports = BigInt(Math.round(parseFloat(process.env.DONATE_SOL ?? "0.1") * LAMPORTS_PER_SOL));
    console.log(`\n[1/3] donate_sol ${Number(lamports) / LAMPORTS_PER_SOL} SOL`);
    const ix = new TransactionInstruction({
      programId: PROGRAM_ID,
      keys: [
        { pubkey: user.publicKey, isSigner: true, isWritable: true },
        { pubkey: donorPda, isSigner: false, isWritable: true },
        { pubkey: vaultPda, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.concat([anchorSighash("donate_sol"), encodeU64LE(lamports), Buffer.from([0])]),
    });
    const tx = new Transaction().add(ix);
    const { blockhash } = await conn.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.feePayer = user.publicKey;
    tx.sign(user);
    const sig = await conn.sendRawTransaction(tx.serialize());
    await conn.confirmTransaction(sig, "confirmed");
    console.log("  sig:", sig);
  } else {
    console.log("\n[1/3] donor PDA exists — skipping donate_sol");
  }

  // ─── Step 2: refresh AARON audit ─────────────────────────────────────────
  console.log("\n[2/3] refresh AARON audit");
  await refreshAaronAudit(user.publicKey.toBase58());

  // ─── Step 3: mint_donor_nft (with B3.10 mpl-core CPI) ────────────────────
  const receiptInfo = await conn.getAccountInfo(receiptPda, "confirmed");
  if (receiptInfo) {
    console.log("\n[3/3] receipt PDA already exists — NFT was previously minted; aborting.");
    console.log("  receipt:", receiptPda.toBase58());
    return;
  }

  console.log("\n[3/3] mint_donor_nft + mpl-core CreateV2");
  const assetKp = Keypair.generate();
  console.log("  asset (NFT address):", assetKp.publicKey.toBase58());

  // Use Pyth Solana Receiver SDK from the joe-jettopics-saas node_modules to
  // build the post + consumer + close bundle.
  const { PythSolanaReceiver } = await import(
    "/Users/jettoptx/OPTX/joe-jettopics-saas/node_modules/@pythnetwork/pyth-solana-receiver"
  );
  const { Wallet, AnchorProvider } = await import(
    "/Users/jettoptx/OPTX/joe-jettopics-saas/node_modules/@coral-xyz/anchor"
  );

  const provider = new (AnchorProvider as any)(conn, new (Wallet as any)(user), {
    commitment: "confirmed",
  });
  const receiver = new (PythSolanaReceiver as any)({ connection: conn, wallet: provider.wallet });
  const txBuilder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });

  const updateData = await fetchPythUpdate();
  await txBuilder.addPostPriceUpdates([updateData]);

  await txBuilder.addPriceConsumerInstructions(
    async (getPriceUpdateAccount: (feedId: string) => PublicKey) => {
      const priceUpdatePda = getPriceUpdateAccount(PYTH_SOL_USD_FEED_ID);
      const mintIx = new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: user.publicKey, isSigner: true, isWritable: true },        // donor_signer
          { pubkey: donorPda, isSigner: false, isWritable: true },             // donor
          { pubkey: receiptPda, isSigner: false, isWritable: true },           // donor_receipt
          { pubkey: vaultPda, isSigner: false, isWritable: false },            // vault_config
          { pubkey: agtPda, isSigner: false, isWritable: false },              // agt_attestation
          { pubkey: auditPda, isSigner: false, isWritable: false },            // aaron_audit
          { pubkey: priceUpdatePda, isSigner: false, isWritable: false },      // pyth_price_update
          { pubkey: assetKp.publicKey, isSigner: true, isWritable: true },     // B3.10: asset
          { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false }, // B3.10: mpl_core_program
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: anchorSighash("mint_donor_nft"),
      });
      return [{ instruction: mintIx, signers: [assetKp] }];
    },
  );

  const versionedTxs = await txBuilder.buildVersionedTransactions({
    computeUnitPriceMicroLamports: 100_000,
  });
  const sigs = await receiver.provider.sendAll(versionedTxs);
  console.log("  tx sigs:", sigs);

  console.log("\n✓ Mint complete!");
  console.log("  NFT asset:", assetKp.publicKey.toBase58());
  console.log("  → Solscan token: https://solscan.io/token/" + assetKp.publicKey.toBase58() + "?cluster=devnet");
  console.log("  → Receipt PDA:   https://solscan.io/account/" + receiptPda.toBase58() + "?cluster=devnet");
  console.log("  → Metadata URI:  https://www.astroknots.space/api/nft/" + receiptPda.toBase58());
}

main().catch((err) => {
  console.error("FAILED:", err);
  if (err.logs) console.error("logs:", err.logs.slice(0, 30));
  process.exit(1);
});
