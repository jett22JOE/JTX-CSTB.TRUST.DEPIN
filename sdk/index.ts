/**
 * JTX OPTX Proof-of-Attention Trust Protocol SDK
 *
 * TypeScript SDK for the PoA trust program + vault on Solana
 * (jettoptx-poa-depin).
 *
 * @packageDocumentation
 */

export {
  // Main client
  TrustClient,
  createTrustClient,

  // Types
  GazeData,
  ComputeProof,
  DeviceType,
  HandshakeStatus,
  ProtocolConfigAccount,
  UserEntropyAccount,
  AttestationAccount,
  HandshakeAccount,

  // Constants
  JTX_MINT_MAINNET,
  LEGACY_COMPUTE_MINT_DEVNET,
  CSTB_MINT_DEVNET,
  DEFAULT_GAZE_THRESHOLD,
  DEFAULT_COMPUTE_DIFFICULTY_MIN,
  DEFAULT_ENTROPY_PER_ATTESTATION,
  DEFAULT_OPTX_PER_ENTROPY,
  PROGRAM_ID,
  PROGRAM_ID_MAINNET,

  // PDA helpers
  getProtocolConfigPDA,
  getUserEntropyPDA,
  getHandshakePDA,
  getAttestationPDA,
  generateHandshakeId,

  // Re-exports from anchor/solana
  PublicKey,
  Keypair,
  Connection,
  BN,
  AnchorProvider,
} from "./trust-client";
