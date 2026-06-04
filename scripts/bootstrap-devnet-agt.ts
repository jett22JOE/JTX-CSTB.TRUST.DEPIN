/**
 * Devnet AGT + AARON-audit bootstrap
 *
 * Creates a synthetic AGT attestation + AARON audit for any wallet on
 * api.devnet.solana.com so we can smoke-test donate_sol + mint_donor_nft
 * end-to-end WITHOUT shipping MOJO iOS first-gaze yet.
 *
 * SECURITY: This script ONLY works on devnet because mainnet still has
 * the iOS gate as the primary funnel. On-chain, aaron_audit is not
 * permissioned — that's a known design gap we'll close before mainnet
 * (council ruling: Squads-only `aaron_operator` allowlist).
 *
 * Usage:
 *   ts-node scripts/bootstrap-devnet-agt.ts <user_pubkey>
 *   ts-node scripts/bootstrap-devnet-agt.ts  (uses CLI default keypair)
 *
 * Pays from: /Users/jettoptx/OPTX/founder-wallet-keypair.json (signs as
 * `user` for AGT) AND /Users/jettoptx/.config/solana/id.json (signs as
 * `aaron_operator` — any signer is accepted on-chain today).
 *
 * If you pass an external pubkey, only the AARON audit is created (the
 * external wallet must sign create_agt_attestation themselves from the
 * UI / a separate run that has their keypair).
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import * as crypto from "crypto";

const PROGRAM_ID = new PublicKey(
  "JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7"
);

// Synthetic gaze tensor [COG, ENV, EMO] on the simplex Δ² with sum = AGT_PRECISION.
// AGT_PRECISION = 1_000_000. We pick a balanced-ish point.
const GAZE_TENSOR = [333_333n, 333_333n, 333_334n];
// Same shape — session-specific seed.
const SESSION_SEED = [100_000n, 200_000n, 300_000n];
// Opaque 32-byte digest. For devnet bootstrap we just use a deterministic
// hash of the wallet pubkey + "devnet-bootstrap-2026-05-10" so it's traceable.
function biometricProofHash(owner: PublicKey): Buffer {
  return crypto
    .createHash("sha256")
    .update(owner.toBuffer())
    .update("devnet-bootstrap-2026-05-10")
    .digest();
}
// Equal difficulty across all axes for the bilinear extension.
const DIFFICULTY_FACTORS = [100_000n, 100_000n, 100_000n];
// Device type 0 = desktop (so it's tagged as bootstrap, not mobile/MOJO).
const DEVICE_TYPE = 0;

function loadKeypair(p: string): Keypair {
  const raw = JSON.parse(fs.readFileSync(p, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(raw));
}

async function main() {
  const argvUser = process.argv[2];

  const conn = new Connection("https://api.devnet.solana.com", "confirmed");

  // Founder pays for AGT (must sign as `user` because of the PDA seed).
  const founder = loadKeypair("/Users/jettoptx/OPTX/founder-wallet-keypair.json");
  // Deployer pays for AARON audit (any signer is accepted on-chain).
  const deployer = loadKeypair("/Users/jettoptx/.config/solana/id.json");

  // Target wallet — if an arg is passed, we only do the AARON audit on
  // their already-created AGT. Otherwise default to the founder so
  // we can do the full bootstrap in one shot.
  const targetUser = argvUser ? new PublicKey(argvUser) : founder.publicKey;
  const bootstrappingFounder = targetUser.equals(founder.publicKey);

  console.log("Devnet AGT bootstrap");
  console.log("  target user:    ", targetUser.toBase58());
  console.log("  aaron_operator: ", deployer.publicKey.toBase58());
  console.log("  full bootstrap: ", bootstrappingFounder);

  // PDAs
  const [vaultConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_config")],
    PROGRAM_ID
  );
  const [agtPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("agt_attestation"), targetUser.toBuffer()],
    PROGRAM_ID
  );
  const [auditPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("aaron_audit"), agtPda.toBuffer()],
    PROGRAM_ID
  );

  console.log("  vault_config:  ", vaultConfigPda.toBase58());
  console.log("  agt_attestation:", agtPda.toBase58());
  console.log("  aaron_audit:    ", auditPda.toBase58());

  // Load IDL + build Anchor Program against founder's provider (default).
  const idl = JSON.parse(
    fs.readFileSync("./target/idl/jett_vault.json", "utf8")
  );
  const founderProvider = new AnchorProvider(
    conn,
    new Wallet(founder),
    { commitment: "confirmed" }
  );
  const founderProgram = new Program(idl, founderProvider);

  const deployerProvider = new AnchorProvider(
    conn,
    new Wallet(deployer),
    { commitment: "confirmed" }
  );
  const deployerProgram = new Program(idl, deployerProvider);

  // Step 1 — create AGT attestation (only if bootstrapping founder).
  if (bootstrappingFounder) {
    const existing = await conn.getAccountInfo(agtPda, "confirmed");
    if (existing) {
      console.log("\n[1/2] AGT attestation already exists — skipping create.");
    } else {
      console.log("\n[1/2] Creating AGT attestation…");
      const sig = await founderProgram.methods
        .createAgtAttestation(
          GAZE_TENSOR.map((n) => new BN(n.toString())) as any,
          SESSION_SEED.map((n) => new BN(n.toString())) as any,
          Array.from(biometricProofHash(targetUser)),
          DIFFICULTY_FACTORS.map((n) => new BN(n.toString())) as any,
          DEVICE_TYPE
        )
        .accounts({
          user: founder.publicKey,
          agtAttestation: agtPda,
          vaultConfig: vaultConfigPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
      console.log("     sig:", sig);
    }
  } else {
    console.log("\n[1/2] External target — assuming AGT already exists.");
    const agtInfo = await conn.getAccountInfo(agtPda, "confirmed");
    if (!agtInfo) {
      console.error("     ERROR: AGT PDA does not exist for", targetUser.toBase58());
      console.error("     The target wallet must call create_agt_attestation themselves first.");
      process.exit(1);
    }
  }

  // Step 2 — create AARON audit (signed by deployer; aaron_operator is unrestricted on-chain).
  const auditExisting = await conn.getAccountInfo(auditPda, "confirmed");
  if (auditExisting) {
    console.log("\n[2/2] AARON audit already exists — refreshing not needed for bootstrap.");
    console.log("     (Note: mint_donor_nft requires audit ≤ 5 min old; rerun if you wait too long.)");
  } else {
    console.log("\n[2/2] Creating AARON audit…");
    const auditHash = crypto
      .createHash("sha256")
      .update(agtPda.toBuffer())
      .update("aaron-devnet-bootstrap")
      .digest();
    const auditNotesHash = crypto.createHash("sha256").update("bootstrap notes").digest();

    const sig = await deployerProgram.methods
      .aaronAudit(
        Array.from(auditHash),
        100, // risk_score = 1.00%
        100, // cog_score
        100, // env_score
        100, // emo_score
        Array.from(auditNotesHash)
      )
      .accounts({
        aaronOperator: deployer.publicKey,
        agtAttestation: agtPda,
        aaronAuditAccount: auditPda,
        vaultConfig: vaultConfigPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });
    console.log("     sig:", sig);
  }

  console.log("\nBootstrap complete.");
  console.log("Explorer:");
  console.log(`  AGT:   https://solscan.io/account/${agtPda.toBase58()}?cluster=devnet`);
  console.log(`  Audit: https://solscan.io/account/${auditPda.toBase58()}?cluster=devnet`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
