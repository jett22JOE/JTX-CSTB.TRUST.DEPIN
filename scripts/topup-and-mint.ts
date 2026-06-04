/**
 * Top-up donate_sol + retry mint_donor_nft for a fresh-wallet smoke test
 * whose first 0.05 SOL donation fell below the $8 NFT threshold.
 *
 * Usage:
 *   ts-node --transpile-only scripts/topup-and-mint.ts <wallet.json> [topup_sol=0.1]
 */
import { Program, AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import {
  Connection, Keypair, PublicKey, SystemProgram, Transaction,
  TransactionInstruction, LAMPORTS_PER_SOL, sendAndConfirmTransaction,
} from "@solana/web3.js";
import * as fs from "fs";
import * as crypto from "crypto";

const PROGRAM_ID = new PublicKey("JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7");
const PYTH_SOL_USD_FEED_ID = "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d";
const HERMES = "https://hermes.pyth.network";

const sighash = (n: string) =>
  crypto.createHash("sha256").update(`global:${n}`).digest().slice(0, 8);

const u64le = (v: bigint) => {
  const b = Buffer.alloc(8);
  for (let i = 0; i < 8; i++) { b[i] = Number(v & 0xffn); v >>= 8n; }
  return b;
};

const load = (p: string) =>
  Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));

async function main() {
  const walletPath = process.argv[2];
  if (!walletPath) throw new Error("usage: topup-and-mint.ts <wallet.json> [topup_sol=0.1]");
  const topupSol = parseFloat(process.argv[3] ?? "0.1");
  const topupLamports = BigInt(Math.round(topupSol * LAMPORTS_PER_SOL));

  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const user = load(walletPath);
  const provider = new AnchorProvider(conn, new Wallet(user), { commitment: "confirmed" });
  const idl = JSON.parse(fs.readFileSync("./target/idl/jett_vault.json", "utf8"));
  const program: any = new Program(idl, provider);

  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault_config")], PROGRAM_ID);
  const [donor] = PublicKey.findProgramAddressSync([Buffer.from("donor"), user.publicKey.toBuffer()], PROGRAM_ID);
  const [receipt] = PublicKey.findProgramAddressSync([Buffer.from("receipt"), vault.toBuffer(), user.publicKey.toBuffer()], PROGRAM_ID);
  const [agt] = PublicKey.findProgramAddressSync([Buffer.from("agt_attestation"), user.publicKey.toBuffer()], PROGRAM_ID);
  const [audit] = PublicKey.findProgramAddressSync([Buffer.from("aaron_audit"), agt.toBuffer()], PROGRAM_ID);

  console.log("Wallet:", user.publicKey.toBase58());
  console.log("Top up by:", topupSol, "SOL");

  // Top up
  const data = Buffer.concat([sighash("donate_sol"), u64le(topupLamports), Buffer.from([0])]);
  const tx = new Transaction().add(new TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [
      { pubkey: user.publicKey, isSigner: true, isWritable: true },
      { pubkey: donor, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  }));
  const sig = await sendAndConfirmTransaction(conn, tx, [user]);
  console.log("  topup sig:", sig);

  // Refetch donor to confirm
  const d = await program.account.donor.fetch(donor);
  console.log("  new amount_lamports:", d.amountLamports.toString());

  // Mint
  console.log("\nFetching Pyth update + minting…");
  const res = await fetch(`${HERMES}/v2/updates/price/latest?ids[]=${PYTH_SOL_USD_FEED_ID.replace(/^0x/, "")}&encoding=base64`);
  const updateData = ((await res.json()) as any).binary.data[0];

  const { PythSolanaReceiver } = await import("/Users/jettoptx/OPTX/joe-jettopics-saas/node_modules/@pythnetwork/pyth-solana-receiver");
  const receiver = new (PythSolanaReceiver as any)({ connection: conn, wallet: provider.wallet });
  const txBuilder = receiver.newTransactionBuilder({ closeUpdateAccounts: true });
  await txBuilder.addPostPriceUpdates([updateData]);
  await txBuilder.addPriceConsumerInstructions(async (getPriceUpdateAccount: (id: string) => PublicKey) => {
    const priceUpdate = getPriceUpdateAccount(PYTH_SOL_USD_FEED_ID);
    return [{
      instruction: new TransactionInstruction({
        programId: PROGRAM_ID,
        keys: [
          { pubkey: user.publicKey, isSigner: true, isWritable: true },
          { pubkey: donor, isSigner: false, isWritable: true },
          { pubkey: receipt, isSigner: false, isWritable: true },
          { pubkey: vault, isSigner: false, isWritable: false },
          { pubkey: agt, isSigner: false, isWritable: false },
          { pubkey: audit, isSigner: false, isWritable: false },
          { pubkey: priceUpdate, isSigner: false, isWritable: false },
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        ],
        data: sighash("mint_donor_nft"),
      }),
      signers: [],
    }];
  });
  const versionedTxs = await txBuilder.buildVersionedTransactions({ computeUnitPriceMicroLamports: 100_000 });
  const sigs = await receiver.provider.sendAll(versionedTxs);
  console.log("  mint sigs:", sigs);

  // Decode receipt
  const r = await program.account.donorReceipt.fetch(receipt);
  console.log("\n✓ NFT RECEIPT MINTED");
  console.log("  donation_value_usdc:", (r.donationValueUsdc.toNumber() / 1_000_000).toFixed(2), "USD");
  console.log("  sol_price_usdc:     ", (r.solPriceUsdc.toNumber() / 1_000_000).toFixed(2), "USD/SOL (Pyth live)");
  console.log("  jtx_entitled:       ", (r.jtxEntitled.toNumber() / 1e9).toFixed(4), "JTX");
  console.log("  minted_at:          ", new Date(r.mintedAt.toNumber() * 1000).toISOString());
  console.log("  multiplier_bps:     ", r.multiplierBps);
  console.log(`\n  Explorer: https://solscan.io/account/${receipt.toBase58()}?cluster=devnet`);
}

main().catch(e => { console.error(e); if (e.logs) console.error(e.logs); process.exit(1); });
