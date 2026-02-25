/**
 * Initialize JTX-CSTB Trust Protocol
 *
 * This script initializes the protocol configuration with:
 * - $JTX token mint (mainnet)
 * - $CSTB token mint (devnet)
 * - $OPTX token mint (deployed via deploy-optx.ts)
 * - Default thresholds and parameters
 *
 * Usage:
 *   ts-node scripts/initialize.ts --cluster devnet
 *   ts-node scripts/initialize.ts --cluster mainnet --optx-mint <address>
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, AnchorProvider, BN, Wallet } from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  SystemProgram,
} from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

// Import IDL (generated after anchor build)
// import { JtxCstbTrust } from "../target/types/jtx_cstb_trust";

// ============================================================================
// CONFIGURATION
// ============================================================================

// Token mints
const JTX_MINT_MAINNET = new PublicKey(
  "9XpJiKEYzq5yDo5pJzRfjSRMPL2yPfDQXgiN7uYtBhUj"
);
const CSTB_MINT_DEVNET = new PublicKey(
  "4waAAfTjqf5LNpj2TC5zoeiAgegVwKWoy4WiJgjdBkVL"
);

// Default protocol parameters
const DEFAULT_CONFIG = {
  gazeThreshold: 222, // 2.22 seconds in centiseconds
  computeDifficultyMin: 1, // 1 = Easy
  entropyPerAttestation: 1000, // Base entropy units
  optxPerEntropy: 1000, // Multiplied by 1000 for precision
};

// ============================================================================
// HELPERS
// ============================================================================

function getProtocolConfigPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    programId
  );
}

function loadKeypair(filepath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filepath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

function parseArgs(): {
  cluster: string;
  optxMint: string | null;
  programId: string;
} {
  const args = process.argv.slice(2);
  let cluster = "devnet";
  let optxMint: string | null = null;
  let programId = "79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cluster" && args[i + 1]) {
      cluster = args[i + 1];
    }
    if (args[i] === "--optx-mint" && args[i + 1]) {
      optxMint = args[i + 1];
    }
    if (args[i] === "--program-id" && args[i + 1]) {
      programId = args[i + 1];
    }
  }

  return { cluster, optxMint, programId };
}

function loadDeploymentInfo(cluster: string): any | null {
  try {
    const infoPath = path.join(__dirname, `../deployments/${cluster}-optx.json`);
    return JSON.parse(fs.readFileSync(infoPath, "utf-8"));
  } catch {
    return null;
  }
}

// ============================================================================
// MAIN INITIALIZATION
// ============================================================================

async function main() {
  const { cluster, optxMint, programId } = parseArgs();

  console.log("========================================");
  console.log("  JTX-CSTB Trust Protocol Initialization");
  console.log("========================================");
  console.log(`Cluster: ${cluster}`);
  console.log(`Program ID: ${programId}`);
  console.log("");

  // Try to load OPTX mint from deployment info or args
  let optxMintPubkey: PublicKey;
  if (optxMint) {
    optxMintPubkey = new PublicKey(optxMint);
  } else {
    const deploymentInfo = loadDeploymentInfo(cluster);
    if (deploymentInfo?.optxMint) {
      optxMintPubkey = new PublicKey(deploymentInfo.optxMint);
      console.log(`Loaded OPTX mint from deployment info: ${optxMintPubkey}`);
    } else {
      console.error("Error: No OPTX mint specified. Use --optx-mint <address>");
      console.error("Or run deploy-optx.ts first to create the mint.");
      process.exit(1);
    }
  }

  // Connect to cluster
  const connection = new Connection(
    cluster === "mainnet"
      ? clusterApiUrl("mainnet-beta")
      : cluster === "devnet"
      ? clusterApiUrl("devnet")
      : "http://localhost:8899",
    "confirmed"
  );

  // Load authority keypair
  const walletPath =
    process.env.WALLET_PATH ||
    path.join(process.env.HOME || "", ".config/solana/id.json");

  console.log(`Loading wallet from: ${walletPath}`);
  const authority = loadKeypair(walletPath);
  console.log(`Authority: ${authority.publicKey.toString()}`);

  // Create Anchor provider
  const wallet = new Wallet(authority);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  // Get program
  const program = new Program(
    require("../target/idl/jtx_cstb_trust.json"),
    new PublicKey(programId),
    provider
  );

  // Get protocol config PDA
  const [protocolConfigPDA] = getProtocolConfigPDA(program.programId);
  console.log(`Protocol Config PDA: ${protocolConfigPDA.toString()}`);

  // Check if already initialized
  try {
    const existingConfig = await program.account.protocolConfig.fetch(
      protocolConfigPDA
    );
    console.log("");
    console.log("Protocol is already initialized!");
    console.log(`  Authority: ${existingConfig.authority.toString()}`);
    console.log(`  JTX Mint: ${existingConfig.jtxMint.toString()}`);
    console.log(`  CSTB Mint: ${existingConfig.cstbMint.toString()}`);
    console.log(`  OPTX Mint: ${existingConfig.optxMint.toString()}`);
    console.log(`  Total Handshakes: ${existingConfig.totalHandshakes.toString()}`);
    console.log(`  Total Attestations: ${existingConfig.totalAttestations.toString()}`);
    console.log(`  Total OPTX Minted: ${existingConfig.totalOptxMinted.toString()}`);
    return;
  } catch {
    // Not initialized, proceed
  }

  // Select token mints based on cluster
  const jtxMint = cluster === "localnet" ? Keypair.generate().publicKey : JTX_MINT_MAINNET;
  const cstbMint = cluster === "mainnet" ? CSTB_MINT_DEVNET : CSTB_MINT_DEVNET;

  console.log("");
  console.log("Configuration:");
  console.log(`  JTX Mint: ${jtxMint.toString()}`);
  console.log(`  CSTB Mint: ${cstbMint.toString()}`);
  console.log(`  OPTX Mint: ${optxMintPubkey.toString()}`);
  console.log(`  Gaze Threshold: ${DEFAULT_CONFIG.gazeThreshold} cs (2.22 seconds)`);
  console.log(`  Min Compute Difficulty: ${DEFAULT_CONFIG.computeDifficultyMin}`);
  console.log(`  Entropy Per Attestation: ${DEFAULT_CONFIG.entropyPerAttestation}`);
  console.log(`  OPTX Per Entropy: ${DEFAULT_CONFIG.optxPerEntropy}`);
  console.log("");

  console.log("Initializing protocol...");

  try {
    const tx = await program.methods
      .initialize(
        new BN(DEFAULT_CONFIG.gazeThreshold),
        DEFAULT_CONFIG.computeDifficultyMin,
        new BN(DEFAULT_CONFIG.entropyPerAttestation),
        new BN(DEFAULT_CONFIG.optxPerEntropy)
      )
      .accounts({
        authority: authority.publicKey,
        protocolConfig: protocolConfigPDA,
        jtxMint: jtxMint,
        cstbMint: cstbMint,
        optxMint: optxMintPubkey,
        systemProgram: SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    console.log("");
    console.log("========================================");
    console.log("  INITIALIZATION SUCCESSFUL!");
    console.log("========================================");
    console.log(`Transaction: ${tx}`);
    console.log("");

    // Verify initialization
    const config = await program.account.protocolConfig.fetch(protocolConfigPDA);
    console.log("Verified Protocol Config:");
    console.log(`  Authority: ${config.authority.toString()}`);
    console.log(`  JTX Mint: ${config.jtxMint.toString()}`);
    console.log(`  CSTB Mint: ${config.cstbMint.toString()}`);
    console.log(`  OPTX Mint: ${config.optxMint.toString()}`);
    console.log(`  Gaze Threshold: ${config.gazeThreshold.toString()} cs`);
    console.log(`  Min Difficulty: ${config.computeDifficultyMin}`);
    console.log(`  Entropy/Attestation: ${config.entropyPerAttestation.toString()}`);
    console.log(`  OPTX/Entropy: ${config.optxPerEntropy.toString()}`);
    console.log("");

    // Save initialization info
    const initInfo = {
      cluster,
      programId: program.programId.toString(),
      protocolConfigPDA: protocolConfigPDA.toString(),
      authority: authority.publicKey.toString(),
      jtxMint: jtxMint.toString(),
      cstbMint: cstbMint.toString(),
      optxMint: optxMintPubkey.toString(),
      transaction: tx,
      timestamp: new Date().toISOString(),
      config: DEFAULT_CONFIG,
    };

    const infoPath = path.join(__dirname, `../deployments/${cluster}-init.json`);
    fs.mkdirSync(path.dirname(infoPath), { recursive: true });
    fs.writeFileSync(infoPath, JSON.stringify(initInfo, null, 2));
    console.log(`Initialization info saved to: ${infoPath}`);

    console.log("");
    console.log("Next Steps:");
    console.log("  1. Users can now create entropy accounts");
    console.log("  2. Initiate handshakes for attestation");
    console.log("  3. Submit gaze attestations (AGT)");
    console.log("  4. Submit compute proofs (CSTB)");
    console.log("  5. Finalize to earn entropy and OPTX allowance");
    console.log("  6. Mint OPTX tokens!");
  } catch (error) {
    console.error("Initialization failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);
