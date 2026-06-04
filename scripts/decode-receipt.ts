/**
 * Decode the donor_receipt PDA to confirm v2 mint_donor_nft fields.
 */
import { Connection, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import { Program, AnchorProvider, Wallet } from "@coral-xyz/anchor";
import { Keypair } from "@solana/web3.js";

const RECEIPT = new PublicKey("GgaPK3gnkLouij9wBcws2dpXofAz5Q6QJ3usmS1i9oCN");
const DONOR = new PublicKey("6RDd3LrkU1tfM1xiAVLHEeDVZyu3rF2dF76yWGs7cLpS");

async function main() {
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const founder = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync("/Users/jettoptx/OPTX/founder-wallet-keypair.json", "utf8")))
  );
  const provider = new AnchorProvider(conn, new Wallet(founder), { commitment: "confirmed" });
  const idl = JSON.parse(fs.readFileSync("./target/idl/jett_vault.json", "utf8"));
  const program: any = new Program(idl as any, provider);

  console.log("Receipt:", RECEIPT.toBase58());
  const r = await program.account.donorReceipt.fetch(RECEIPT);
  console.log("  donor:               ", r.donor.toBase58());
  console.log("  vault:               ", r.vault.toBase58());
  console.log("  donation_lamports:   ", r.donationLamports.toString());
  console.log("  donation_value_usdc: ", r.donationValueUsdc.toString(), "(6-decimal USDC)");
  console.log("  sol_price_usdc:      ", r.solPriceUsdc.toString(), "(6-decimal — Pyth!)");
  console.log("  jtx_entitled:        ", r.jtxEntitled.toString(), "(9-decimal JTX base)");
  console.log("  jtx_price_usdc:      ", r.jtxPriceUsdc.toString());
  console.log("  multiplier_bps:      ", r.multiplierBps);
  console.log("  minted_at:           ", new Date(r.mintedAt.toNumber() * 1000).toISOString());
  console.log("  claimed:             ", r.claimed);
  console.log("  payment_method:      ", r.paymentMethod, "(0=SOL, 1=USDC)");
  console.log();

  console.log("Donor PDA:", DONOR.toBase58());
  const d = await program.account.donor.fetch(DONOR);
  console.log("  wallet:              ", d.wallet.toBase58());
  console.log("  amount_lamports:     ", d.amountLamports.toString());
  console.log("  nft_minted:          ", d.nftMinted);
  console.log("  optx_multiplier_bps: ", d.optxMultiplierBps);
}

main().catch(e => { console.error(e); process.exit(1); });
