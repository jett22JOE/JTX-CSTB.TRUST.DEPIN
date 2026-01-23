/**
 * JTX-CSTB Trust Protocol SDK
 *
 * A TypeScript SDK for interacting with the JTX-CSTB Trust Protocol
 * smart contract on Solana.
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
  CSTB_MINT_DEVNET,
  DEFAULT_GAZE_THRESHOLD,
  DEFAULT_COMPUTE_DIFFICULTY_MIN,
  DEFAULT_ENTROPY_PER_ATTESTATION,
  DEFAULT_OPTX_PER_ENTROPY,
  PROGRAM_ID,

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
