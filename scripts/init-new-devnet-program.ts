/**
 * One-shot initialization for the new devnet jett-vault program at
 * CFXw63o3bH6mRHukLF495rKaU1bp5eqbnyVT3xNFitsz. Calls initialize_vault
 * + bootstraps AGT + AARON audit for the founder so the smoke-test path
 * works end-to-end immediately.
 *
 * Usage:
 *   ts-node --transpile-only scripts/init-new-devnet-program.ts
 *
 * Idempotent: each step checks whether the on-chain account already
 * exists and skips the call if so.
 */
import { Program, AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import {
  Connection, Keypair, PublicKey, SystemProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import * as crypto from "crypto";

const PROGRAM_ID = new PublicKey("CFXw63o3bH6mRHukLF495rKaU1bp5eqbnyVT3xNFitsz");

// Goal: 5874 SOL (mirrors astroknots.space UI constant).
const GOAL_LAMPORTS = BigInt(5874) * BigInt(1_000_000_000);
// Phase 1 ends 2026-08-31; Phase 2 ends 2026-12-31. Both well in the future.
const PHASE_1_DEADLINE = Math.floor(new Date("2026-08-31T23:59:59Z").getTime() / 1000);
const PHASE_2_DEADLINE = Math.floor(new Date("2026-12-31T23:59:59Z").getTime() / 1000);

// 2-of-3 multisig signers for pause/close: founder + JOE agent + 3rd backup.
const MULTISIG_SIGNERS = [
  "FEUwuvXbbSYTCEhhqgAt2viTsEnromNNDsapoFvyfy3H", // founder
  "EFvgELE1Hb4PC5tbPTAe8v1uEDGee8nwYBMCU42bZRGk", // JOE agent
  "FADKaMRVWdgsQXMhdBTLktdZqaEMA2VxmYcuhqhQ5SMC", // deployer (cold-backup)
];

function load(p: string): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8"))));
}

async function main() {
  const conn = new Connection("https://api.devnet.solana.com", "confirmed");
  const founder = load("/Users/jettoptx/OPTX/founder-wallet-keypair.json");
  const deployer = load("/Users/jettoptx/.config/solana/id.json");

  // IDL points at the source declare_id! (mainnet ID). We override the
  // anchor Program's programId when constructing it so the right addresses
  // are used for PDA derivation and ix building.
  const idl = JSON.parse(fs.readFileSync("./target/idl/jett_vault.json", "utf8"));
  idl.address = PROGRAM_ID.toBase58();
  // Anchor 0.30 stores program ID under metadata.address in IDL — patch both.
  if (idl.metadata) idl.metadata.address = PROGRAM_ID.toBase58();

  const founderProv = new AnchorProvider(conn, new Wallet(founder), { commitment: "confirmed" });
  const deployerProv = new AnchorProvider(conn, new Wallet(deployer), { commitment: "confirmed" });
  const founderProg: any = new Program(idl, founderProv);
  const deployerProg: any = new Program(idl, deployerProv);

  // ─── 1) initialize_vault ──────────────────────────────────────────────
  const [vaultPda] = PublicKey.findProgramAddressSync([Buffer.from("vault_config")], PROGRAM_ID);
  console.log("vault_config PDA:", vaultPda.toBase58());

  const vaultInfo = await conn.getAccountInfo(vaultPda, "confirmed");
  if (vaultInfo) {
    console.log("[1/3] vault_config already initialized — skipping.");
  } else {
    console.log("[1/3] initialize_vault…");
    const sig = await founderProg.methods
      .initializeVault(
        new BN(GOAL_LAMPORTS.toString()),
        new BN(PHASE_1_DEADLINE),
        new BN(PHASE_2_DEADLINE),
        MULTISIG_SIGNERS.map(s => new PublicKey(s)),
      )
      .accounts({
        founder: founder.publicKey,
        vaultConfig: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });
    console.log("    sig:", sig);
  }

  // ─── 2) create AGT attestation for founder ────────────────────────────
  const [agtPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("agt_attestation"), founder.publicKey.toBuffer()],
    PROGRAM_ID,
  );
  console.log("\nfounder AGT PDA:", agtPda.toBase58());

  const agtInfo = await conn.getAccountInfo(agtPda, "confirmed");
  if (agtInfo) {
    console.log("[2/3] AGT already exists — skipping.");
  } else {
    console.log("[2/3] create_agt_attestation…");
    const biometricHash = crypto.createHash("sha256")
      .update(founder.publicKey.toBuffer())
      .update("devnet-bootstrap-2026-05-14")
      .digest();
    const sig = await founderProg.methods
      .createAgtAttestation(
        [new BN("333333"), new BN("333333"), new BN("333334")],
        [new BN("100000"), new BN("200000"), new BN("300000")],
        Array.from(biometricHash),
        [new BN("100000"), new BN("100000"), new BN("100000")],
        0,
      )
      .accounts({
        user: founder.publicKey,
        agtAttestation: agtPda,
        vaultConfig: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });
    console.log("    sig:", sig);
  }

  // ─── 3) aaron_audit for founder AGT ───────────────────────────────────
  const [auditPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("aaron_audit"), agtPda.toBuffer()],
    PROGRAM_ID,
  );
  console.log("\nfounder audit PDA:", auditPda.toBase58());
  const auditInfo = await conn.getAccountInfo(auditPda, "confirmed");
  if (auditInfo) {
    console.log("[3/3] AARON audit already exists — skipping.");
  } else {
    console.log("[3/3] aaron_audit (deployer signs as operator)…");
    const auditHash = crypto.createHash("sha256").update(agtPda.toBuffer()).update("audit").digest();
    const notesHash = crypto.createHash("sha256").update("init-bootstrap").digest();
    const sig = await deployerProg.methods
      .aaronAudit(
        Array.from(auditHash),
        100, 100, 100, 100,
        Array.from(notesHash),
      )
      .accounts({
        aaronOperator: deployer.publicKey,
        agtAttestation: agtPda,
        aaronAuditAccount: auditPda,
        vaultConfig: vaultPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc({ commitment: "confirmed" });
    console.log("    sig:", sig);
  }

  console.log("\nDone.");
  console.log(`Explorer: https://solscan.io/account/${PROGRAM_ID.toBase58()}?cluster=devnet`);
}

main().catch(e => { console.error(e); process.exit(1); });
