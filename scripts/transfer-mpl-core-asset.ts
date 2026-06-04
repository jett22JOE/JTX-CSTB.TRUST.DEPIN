/**
 * Transfer an mpl-core asset via raw TransferV1 ix.
 *
 * Used to deliver a CLI-minted founder NFT into Josh's JOE agent Phantom
 * wallet so he can SEE a real wallet-visible JTX Genesis Receipt while
 * we debug his browser-side mint failure separately.
 *
 * Account ordering from generated IDL (transferV1.js):
 *   0 asset           (writable)
 *   1 collection      (default = MPL_CORE program ID as None sentinel)
 *   2 payer           (signer, writable)
 *   3 authority       (signer; defaults to payer)
 *   4 newOwner        (read-only)
 *   5 systemProgram
 *   6 logWrapper      (default = MPL_CORE program ID as None sentinel)
 *
 * Data: [u8 discriminator=14, option<CompressionProof>=None]
 *
 * Usage:
 *   ASSET=<pubkey> TO=<recipient> npx ts-node --transpile-only scripts/transfer-mpl-core-asset.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as fs from "fs";

const MPL_CORE_PROGRAM_ID = new PublicKey("CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d");

function loadKeypair(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

async function main() {
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const owner = loadKeypair(process.env.WALLET ?? `${process.env.HOME}/OPTX/founder-wallet-keypair.json`);
  const asset = new PublicKey(process.env.ASSET ?? "DfwnZ4owq8q4j2cQVCUyqAH7Cit9pQzmwephJ8ZjBctS");
  const to = new PublicKey(process.env.TO ?? "EFvgELE1Hb4PC5tbPTAe8v1uEDGee8nwYBMCU42bZRGk");

  console.log("Transfer mpl-core asset:");
  console.log("  asset:", asset.toBase58());
  console.log("  from: ", owner.publicKey.toBase58());
  console.log("  to:   ", to.toBase58());

  // TransferV1 ix: discriminator 14, compressionProof = None (0x00)
  const data = Buffer.from([14, 0]);

  const ix = new TransactionInstruction({
    programId: MPL_CORE_PROGRAM_ID,
    keys: [
      { pubkey: asset, isSigner: false, isWritable: true },             // 0 asset
      { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false }, // 1 collection (None sentinel)
      { pubkey: owner.publicKey, isSigner: true, isWritable: true },    // 2 payer
      { pubkey: owner.publicKey, isSigner: true, isWritable: false },   // 3 authority
      { pubkey: to, isSigner: false, isWritable: false },               // 4 newOwner
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false }, // 5 systemProgram
      { pubkey: MPL_CORE_PROGRAM_ID, isSigner: false, isWritable: false }, // 6 logWrapper (None sentinel)
    ],
    data,
  });

  const tx = new Transaction().add(ix);
  const { blockhash } = await conn.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = owner.publicKey;
  tx.sign(owner);

  const sig = await conn.sendRawTransaction(tx.serialize());
  await conn.confirmTransaction(sig, "confirmed");
  console.log("✓ Transferred. sig:", sig);
  console.log("  Solscan: https://solscan.io/tx/" + sig + "?cluster=devnet");
  console.log("  Asset:   https://solscan.io/token/" + asset.toBase58() + "?cluster=devnet");
}

main().catch((e) => {
  console.error("FAILED:", e);
  if ((e as any).logs) console.error("logs:", (e as any).logs.slice(0, 30));
  process.exit(1);
});
