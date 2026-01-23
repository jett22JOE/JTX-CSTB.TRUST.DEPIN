/**
 * Deploy $OPTX Token (Token-2022)
 *
 * This script deploys the $OPTX token with the following specifications:
 * - Token Standard: SPL Token-2022
 * - Total Supply: 22,000,000 OPTX
 * - Decimals: 6
 * - Mint Authority: Protocol PDA
 * - Freeze Authority: None (fully decentralized)
 *
 * Usage:
 *   ts-node scripts/deploy-optx.ts --cluster devnet
 *   ts-node scripts/deploy-optx.ts --cluster mainnet
 */

import {
  Connection,
  Keypair,
  PublicKey,
  clusterApiUrl,
  sendAndConfirmTransaction,
  Transaction,
  SystemProgram,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createInitializeMintInstruction,
  getMintLen,
  ExtensionType,
  createInitializeTransferHookInstruction,
  createInitializeMetadataPointerInstruction,
  TYPE_SIZE,
  LENGTH_SIZE,
} from "@solana/spl-token";
import {
  createInitializeInstruction,
  pack,
  TokenMetadata,
} from "@solana/spl-token-metadata";
import * as fs from "fs";
import * as path from "path";

// ============================================================================
// CONFIGURATION
// ============================================================================

// $OPTX Token Configuration
const OPTX_CONFIG = {
  name: "OPTX",
  symbol: "OPTX",
  decimals: 6,
  totalSupply: 22_000_000 * 10 ** 6, // 22M with 6 decimals
  uri: "https://jettoptics.ai/tokens/optx.json", // Metadata URI
  description: "JTX-CSTB Trust Protocol Attestation Token",
};

// Protocol PDA seed
const PROTOCOL_CONFIG_SEED = "protocol-config";

// ============================================================================
// HELPERS
// ============================================================================

function getProtocolConfigPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PROTOCOL_CONFIG_SEED)],
    programId
  );
}

function loadKeypair(filepath: string): Keypair {
  const secretKey = JSON.parse(fs.readFileSync(filepath, "utf-8"));
  return Keypair.fromSecretKey(new Uint8Array(secretKey));
}

function parseArgs(): { cluster: string; programId: string } {
  const args = process.argv.slice(2);
  let cluster = "devnet";
  let programId = "Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--cluster" && args[i + 1]) {
      cluster = args[i + 1];
    }
    if (args[i] === "--program-id" && args[i + 1]) {
      programId = args[i + 1];
    }
  }

  return { cluster, programId };
}

// ============================================================================
// MAIN DEPLOYMENT
// ============================================================================

async function main() {
  const { cluster, programId } = parseArgs();

  console.log("========================================");
  console.log("  $OPTX Token Deployment (Token-2022)");
  console.log("========================================");
  console.log(`Cluster: ${cluster}`);
  console.log(`Program ID: ${programId}`);
  console.log("");

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

  // Get protocol PDA (will be mint authority)
  const [protocolConfigPDA] = getProtocolConfigPDA(new PublicKey(programId));
  console.log(`Protocol Config PDA: ${protocolConfigPDA.toString()}`);
  console.log("  (This will be the mint authority)");
  console.log("");

  // Generate mint keypair
  const mintKeypair = Keypair.generate();
  console.log(`$OPTX Mint Address: ${mintKeypair.publicKey.toString()}`);

  // Calculate space needed for Token-2022 with metadata
  const metadata: TokenMetadata = {
    mint: mintKeypair.publicKey,
    name: OPTX_CONFIG.name,
    symbol: OPTX_CONFIG.symbol,
    uri: OPTX_CONFIG.uri,
    additionalMetadata: [
      ["description", OPTX_CONFIG.description],
      ["total_supply", OPTX_CONFIG.totalSupply.toString()],
      ["protocol", "JTX-CSTB Trust"],
    ],
  };

  const metadataLen = pack(metadata).length;
  const mintLen =
    getMintLen([ExtensionType.MetadataPointer]) +
    TYPE_SIZE +
    LENGTH_SIZE +
    metadataLen;

  // Calculate rent
  const lamports = await connection.getMinimumBalanceForRentExemption(mintLen);

  console.log(`Mint account size: ${mintLen} bytes`);
  console.log(`Rent required: ${lamports / 1e9} SOL`);
  console.log("");

  // Build transaction
  const transaction = new Transaction();

  // 1. Create account for mint
  transaction.add(
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      space: mintLen,
      lamports,
      programId: TOKEN_2022_PROGRAM_ID,
    })
  );

  // 2. Initialize metadata pointer extension
  transaction.add(
    createInitializeMetadataPointerInstruction(
      mintKeypair.publicKey,
      authority.publicKey, // Update authority
      mintKeypair.publicKey, // Metadata address (same as mint for Token-2022)
      TOKEN_2022_PROGRAM_ID
    )
  );

  // 3. Initialize mint
  transaction.add(
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      OPTX_CONFIG.decimals,
      protocolConfigPDA, // Mint authority is the protocol PDA
      null, // No freeze authority
      TOKEN_2022_PROGRAM_ID
    )
  );

  // 4. Initialize metadata
  transaction.add(
    createInitializeInstruction({
      programId: TOKEN_2022_PROGRAM_ID,
      mint: mintKeypair.publicKey,
      metadata: mintKeypair.publicKey,
      name: metadata.name,
      symbol: metadata.symbol,
      uri: metadata.uri,
      mintAuthority: protocolConfigPDA,
      updateAuthority: authority.publicKey,
    })
  );

  console.log("Sending transaction...");

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [authority, mintKeypair],
      { commitment: "confirmed" }
    );

    console.log("");
    console.log("========================================");
    console.log("  DEPLOYMENT SUCCESSFUL!");
    console.log("========================================");
    console.log(`Transaction: ${signature}`);
    console.log(`$OPTX Mint: ${mintKeypair.publicKey.toString()}`);
    console.log("");
    console.log("Token Details:");
    console.log(`  Name: ${OPTX_CONFIG.name}`);
    console.log(`  Symbol: ${OPTX_CONFIG.symbol}`);
    console.log(`  Decimals: ${OPTX_CONFIG.decimals}`);
    console.log(`  Total Supply: 22,000,000 OPTX (to be minted)`);
    console.log(`  Mint Authority: ${protocolConfigPDA.toString()} (Protocol PDA)`);
    console.log(`  Freeze Authority: None`);
    console.log("");
    console.log("Next Steps:");
    console.log("  1. Update Anchor.toml with mint address");
    console.log("  2. Initialize protocol with: ts-node scripts/initialize.ts");
    console.log("  3. Verify on Solana Explorer");
    console.log("");

    // Save mint info to file
    const deploymentInfo = {
      cluster,
      programId,
      optxMint: mintKeypair.publicKey.toString(),
      protocolConfigPDA: protocolConfigPDA.toString(),
      transaction: signature,
      timestamp: new Date().toISOString(),
      config: OPTX_CONFIG,
    };

    const infoPath = path.join(__dirname, `../deployments/${cluster}-optx.json`);
    fs.mkdirSync(path.dirname(infoPath), { recursive: true });
    fs.writeFileSync(infoPath, JSON.stringify(deploymentInfo, null, 2));
    console.log(`Deployment info saved to: ${infoPath}`);
  } catch (error) {
    console.error("Deployment failed:", error);
    process.exit(1);
  }
}

main().catch(console.error);
