import * as anchor from "@coral-xyz/anchor";
import { Program, BN, AnchorProvider } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  TOKEN_2022_PROGRAM_ID,
  createMint,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountInstruction,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";

// Import the program IDL (generated after anchor build)
import { JtxOptxDevnetPoaTrustjoe } from "../target/types/jtx_optx_devnet_poa_trustjoe";

// ============================================================================
// TEST CONSTANTS
// ============================================================================

// $JTX v2 mainnet mint (cloned in test validator)
const JTX_MINT = new PublicKey("JTXGnx83s2QZ2MwYkRD1cBKrqQKSdG5oe8vSYW5Zjoe");

// Legacy compute-mint layout slot (devnet) — unused for gating
const LEGACY_COMPUTE_MINT = new PublicKey("4waAAfTjqf5LNpj2TC5zoeiAgegVwKWoy4WiJgjdBkVL");

// Default thresholds
const DEFAULT_GAZE_THRESHOLD = 222; // 2.22 seconds
const DEFAULT_COMPUTE_DIFFICULTY_MIN = 1;
const DEFAULT_ENTROPY_PER_ATTESTATION = 1000;
const DEFAULT_OPTX_PER_ENTROPY = 1000;

// Sample test data
const createSampleGazeData = () => ({
  tensorHash: new Uint8Array(32).fill(0xab), // Mock AGT hash
  durationCs: 250, // 2.5 seconds
  cogVector: [100, -50, 25] as [number, number, number],
  emoVector: [-30, 80, 10] as [number, number, number],
  envVector: [60, 40, -20] as [number, number, number],
  gazeEntropy: new BN(1500), // Entropy from gaze patterns
});

const createSampleComputeProof = () => ({
  proofHash: new Uint8Array(32).fill(0xcd), // Mock opaque compute proof hash
  difficulty: 2, // Medium
  deviceType: 2, // Laptop
  nonce: new BN(123456789),
  computeEntropy: new BN(1000), // Entropy from compute
});

// ============================================================================
// PDA HELPERS
// ============================================================================

function getProtocolConfigPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("protocol-config")],
    programId
  );
}

function getUserEntropyPDA(
  user: PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("user-entropy"), user.toBuffer()],
    programId
  );
}

function getHandshakePDA(
  user: PublicKey,
  handshakeId: Uint8Array,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("handshake"), user.toBuffer(), Buffer.from(handshakeId)],
    programId
  );
}

function getAttestationPDA(
  owner: PublicKey,
  handshakeId: Uint8Array,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("attestation"), owner.toBuffer(), Buffer.from(handshakeId)],
    programId
  );
}

function generateHandshakeId(): Uint8Array {
  return Keypair.generate().publicKey.toBytes();
}

// ============================================================================
// TEST SUITE
// ============================================================================

describe("JTX OPTX PoA Trust Protocol", () => {
  // Configure the client to use the local cluster
  const provider = AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.JtxOptxDevnetPoaTrustjoe as Program<JtxOptxDevnetPoaTrustjoe>;
  const programId = program.programId;

  // Test accounts
  let authority: Keypair;
  let user1: Keypair;
  let user2: Keypair;
  let optxMint: PublicKey;

  // PDAs
  let protocolConfigPDA: PublicKey;
  let user1EntropyPDA: PublicKey;

  before(async () => {
    // Generate test keypairs
    authority = Keypair.generate();
    user1 = Keypair.generate();
    user2 = Keypair.generate();

    // Airdrop SOL to test accounts
    const airdropAmount = 10 * LAMPORTS_PER_SOL;

    await Promise.all([
      provider.connection.requestAirdrop(authority.publicKey, airdropAmount),
      provider.connection.requestAirdrop(user1.publicKey, airdropAmount),
      provider.connection.requestAirdrop(user2.publicKey, airdropAmount),
    ]);

    // Wait for airdrops to confirm
    await new Promise((resolve) => setTimeout(resolve, 2000));

    // Derive PDAs
    [protocolConfigPDA] = getProtocolConfigPDA(programId);
    [user1EntropyPDA] = getUserEntropyPDA(user1.publicKey, programId);

    // Create $OPTX mint (Token-2022) with protocol config as mint authority
    // Note: In real deployment, this would be done via the deploy-optx script
    optxMint = await createMint(
      provider.connection,
      authority,
      protocolConfigPDA, // Mint authority is the protocol PDA
      null, // No freeze authority
      6, // 6 decimals
      Keypair.generate(),
      undefined,
      TOKEN_2022_PROGRAM_ID
    );

    console.log("Test setup complete:");
    console.log("  Authority:", authority.publicKey.toString());
    console.log("  User1:", user1.publicKey.toString());
    console.log("  User2:", user2.publicKey.toString());
    console.log("  OPTX Mint:", optxMint.toString());
    console.log("  Protocol Config PDA:", protocolConfigPDA.toString());
  });

  // ==========================================================================
  // INITIALIZATION TESTS
  // ==========================================================================

  describe("Initialization", () => {
    it("should initialize the protocol config", async () => {
      await program.methods
        .initialize(
          new BN(DEFAULT_GAZE_THRESHOLD),
          DEFAULT_COMPUTE_DIFFICULTY_MIN,
          new BN(DEFAULT_ENTROPY_PER_ATTESTATION),
          new BN(DEFAULT_OPTX_PER_ENTROPY)
        )
        .accounts({
          authority: authority.publicKey,
          protocolConfig: protocolConfigPDA,
          jtxMint: JTX_MINT,
          cstbMint: LEGACY_COMPUTE_MINT,
          optxMint: optxMint,
          systemProgram: SystemProgram.programId,
        })
        .signers([authority])
        .rpc();

      // Fetch and verify config
      const config = await program.account.protocolConfig.fetch(
        protocolConfigPDA
      );

      expect(config.authority.toString()).to.equal(
        authority.publicKey.toString()
      );
      expect(config.jtxMint.toString()).to.equal(JTX_MINT.toString());
      expect(config.cstbMint.toString()).to.equal(LEGACY_COMPUTE_MINT.toString());
      expect(config.optxMint.toString()).to.equal(optxMint.toString());
      expect(config.totalHandshakes.toNumber()).to.equal(0);
      expect(config.totalAttestations.toNumber()).to.equal(0);
      expect(config.totalOptxMinted.toNumber()).to.equal(0);
      expect(config.gazeThreshold.toNumber()).to.equal(DEFAULT_GAZE_THRESHOLD);
      expect(config.computeDifficultyMin).to.equal(
        DEFAULT_COMPUTE_DIFFICULTY_MIN
      );
      expect(config.entropyPerAttestation.toNumber()).to.equal(
        DEFAULT_ENTROPY_PER_ATTESTATION
      );
      expect(config.optxPerEntropy.toNumber()).to.equal(DEFAULT_OPTX_PER_ENTROPY);

      console.log("  Protocol initialized successfully");
    });

    it("should create user entropy account", async () => {
      await program.methods
        .createUserEntropy()
        .accounts({
          user: user1.publicKey,
          userEntropy: user1EntropyPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // Fetch and verify
      const userEntropy = await program.account.userEntropy.fetch(
        user1EntropyPDA
      );

      expect(userEntropy.owner.toString()).to.equal(user1.publicKey.toString());
      expect(userEntropy.totalEntropy.toNumber()).to.equal(0);
      expect(userEntropy.entropyUsed.toNumber()).to.equal(0);
      expect(userEntropy.attestationCount.toNumber()).to.equal(0);
      expect(userEntropy.optxMintingAllowance.toNumber()).to.equal(0);

      console.log("  User entropy account created successfully");
    });
  });

  // ==========================================================================
  // HAPPY PATH TESTS
  // ==========================================================================

  describe("Happy Path: Full Attestation Flow", () => {
    let handshakeId: Uint8Array;
    let handshakePDA: PublicKey;
    let attestationPDA: PublicKey;

    before(() => {
      handshakeId = generateHandshakeId();
      [handshakePDA] = getHandshakePDA(user1.publicKey, handshakeId, programId);
      [attestationPDA] = getAttestationPDA(
        user1.publicKey,
        handshakeId,
        programId
      );
    });

    it("should initiate a handshake", async () => {
      await program.methods
        .initiateHandshake(Array.from(handshakeId))
        .accounts({
          user: user1.publicKey,
          handshake: handshakePDA,
          protocolConfig: protocolConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // Fetch and verify
      const handshake = await program.account.handshake.fetch(handshakePDA);

      expect(handshake.initiator.toString()).to.equal(
        user1.publicKey.toString()
      );
      expect(Buffer.from(handshake.handshakeId).equals(Buffer.from(handshakeId)))
        .to.be.true;
      expect(handshake.gazeVerified).to.be.false;
      expect(handshake.computeVerified).to.be.false;
      expect(handshake.attestationComplete).to.be.false;

      // Verify expiry is ~1 hour from now
      const now = Math.floor(Date.now() / 1000);
      expect(handshake.expiresAt.toNumber()).to.be.greaterThan(now + 3500);
      expect(handshake.expiresAt.toNumber()).to.be.lessThan(now + 3700);

      console.log("  Handshake initiated successfully");
    });

    it("should submit gaze attestation", async () => {
      const gazeData = createSampleGazeData();

      await program.methods
        .submitGazeAttestation(
          Array.from(gazeData.tensorHash),
          gazeData.cogVector,
          gazeData.emoVector,
          gazeData.envVector,
          new BN(gazeData.durationCs),
          gazeData.gazeEntropy
        )
        .accounts({
          user: user1.publicKey,
          handshake: handshakePDA,
          protocolConfig: protocolConfigPDA,
        })
        .signers([user1])
        .rpc();

      // Fetch and verify
      const handshake = await program.account.handshake.fetch(handshakePDA);

      expect(handshake.gazeVerified).to.be.true;
      expect(handshake.gazeVerifiedAt.toNumber()).to.be.greaterThan(0);
      expect(
        Buffer.from(handshake.gazeTensorHash).equals(
          Buffer.from(gazeData.tensorHash)
        )
      ).to.be.true;
      expect(handshake.cogVector).to.deep.equal(gazeData.cogVector);
      expect(handshake.emoVector).to.deep.equal(gazeData.emoVector);
      expect(handshake.envVector).to.deep.equal(gazeData.envVector);
      expect(handshake.gazeEntropy.toNumber()).to.equal(
        gazeData.gazeEntropy.toNumber()
      );

      // Not complete yet (compute not verified)
      expect(handshake.attestationComplete).to.be.false;

      console.log("  Gaze attestation submitted successfully");
    });

    it("should submit compute proof and auto-finalize", async () => {
      const computeProof = createSampleComputeProof();

      await program.methods
        .submitComputeProof(
          Array.from(computeProof.proofHash),
          computeProof.difficulty,
          computeProof.deviceType,
          computeProof.nonce,
          computeProof.computeEntropy
        )
        .accounts({
          user: user1.publicKey,
          handshake: handshakePDA,
          protocolConfig: protocolConfigPDA,
        })
        .signers([user1])
        .rpc();

      // Fetch and verify
      const handshake = await program.account.handshake.fetch(handshakePDA);

      expect(handshake.computeVerified).to.be.true;
      expect(handshake.computeVerifiedAt.toNumber()).to.be.greaterThan(0);
      expect(
        Buffer.from(handshake.computeProofHash).equals(
          Buffer.from(computeProof.proofHash)
        )
      ).to.be.true;
      expect(handshake.difficultyLevel).to.equal(computeProof.difficulty);
      expect(handshake.deviceType).to.equal(computeProof.deviceType);
      expect(handshake.proofNonce.toNumber()).to.equal(
        computeProof.nonce.toNumber()
      );
      expect(handshake.computeEntropy.toNumber()).to.equal(
        computeProof.computeEntropy.toNumber()
      );

      // Should auto-finalize since gaze was already verified
      expect(handshake.attestationComplete).to.be.true;

      console.log("  Compute proof submitted and auto-finalized");
    });

    it("should finalize attestation and accumulate entropy", async () => {
      await program.methods
        .finalizeAttestation()
        .accounts({
          user: user1.publicKey,
          handshake: handshakePDA,
          attestation: attestationPDA,
          userEntropy: user1EntropyPDA,
          protocolConfig: protocolConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      // Fetch attestation
      const attestation = await program.account.attestation.fetch(
        attestationPDA
      );
      const gazeData = createSampleGazeData();
      const computeProof = createSampleComputeProof();

      expect(attestation.owner.toString()).to.equal(user1.publicKey.toString());
      expect(attestation.isValid).to.be.true;
      expect(attestation.revokedAt).to.be.null;

      // Verify combined entropy
      const expectedCombinedEntropy =
        gazeData.gazeEntropy.toNumber() + computeProof.computeEntropy.toNumber();
      expect(attestation.combinedEntropy.toNumber()).to.equal(
        expectedCombinedEntropy
      );

      // Verify combined hash is concatenation of gaze and compute hashes
      expect(attestation.combinedHash.length).to.equal(64);
      expect(
        Buffer.from(attestation.combinedHash.slice(0, 32)).equals(
          Buffer.from(gazeData.tensorHash)
        )
      ).to.be.true;
      expect(
        Buffer.from(attestation.combinedHash.slice(32)).equals(
          Buffer.from(computeProof.proofHash)
        )
      ).to.be.true;

      // Fetch user entropy
      const userEntropy = await program.account.userEntropy.fetch(
        user1EntropyPDA
      );

      expect(userEntropy.totalEntropy.toNumber()).to.equal(
        expectedCombinedEntropy
      );
      expect(userEntropy.attestationCount.toNumber()).to.equal(1);
      expect(userEntropy.lastAttestation.toNumber()).to.be.greaterThan(0);

      // Verify OPTX allowance calculation
      // Formula: combinedEntropy * difficulty * optxPerEntropy / 1000
      const expectedAllowance =
        (expectedCombinedEntropy * computeProof.difficulty * DEFAULT_OPTX_PER_ENTROPY) / 1000;
      expect(userEntropy.optxMintingAllowance.toNumber()).to.equal(
        expectedAllowance
      );

      // Fetch protocol config to verify counters
      const config = await program.account.protocolConfig.fetch(
        protocolConfigPDA
      );
      expect(config.totalAttestations.toNumber()).to.equal(1);

      console.log("  Attestation finalized successfully");
      console.log(`  Combined entropy: ${expectedCombinedEntropy}`);
      console.log(`  OPTX minting allowance: ${expectedAllowance}`);
    });

    it("should verify attestation", async () => {
      // Use verifyAttestation instruction (read-only)
      const attestation = await program.account.attestation.fetch(
        attestationPDA
      );

      expect(attestation.isValid).to.be.true;
      expect(attestation.revokedAt).to.be.null;

      console.log("  Attestation verified successfully");
    });
  });

  // ==========================================================================
  // ORDER INDEPENDENCE TESTS
  // ==========================================================================

  describe("Order Independence: Compute First, Then Gaze", () => {
    let handshakeId: Uint8Array;
    let handshakePDA: PublicKey;

    before(async () => {
      // Create user entropy for user2
      const [user2EntropyPDA] = getUserEntropyPDA(user2.publicKey, programId);

      await program.methods
        .createUserEntropy()
        .accounts({
          user: user2.publicKey,
          userEntropy: user2EntropyPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();

      handshakeId = generateHandshakeId();
      [handshakePDA] = getHandshakePDA(user2.publicKey, handshakeId, programId);

      // Initiate handshake
      await program.methods
        .initiateHandshake(Array.from(handshakeId))
        .accounts({
          user: user2.publicKey,
          handshake: handshakePDA,
          protocolConfig: protocolConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user2])
        .rpc();
    });

    it("should allow compute proof submission first", async () => {
      const computeProof = createSampleComputeProof();

      await program.methods
        .submitComputeProof(
          Array.from(computeProof.proofHash),
          computeProof.difficulty,
          computeProof.deviceType,
          computeProof.nonce,
          computeProof.computeEntropy
        )
        .accounts({
          user: user2.publicKey,
          handshake: handshakePDA,
          protocolConfig: protocolConfigPDA,
        })
        .signers([user2])
        .rpc();

      const handshake = await program.account.handshake.fetch(handshakePDA);

      expect(handshake.computeVerified).to.be.true;
      expect(handshake.gazeVerified).to.be.false;
      expect(handshake.attestationComplete).to.be.false;

      console.log("  Compute proof submitted first (gaze pending)");
    });

    it("should auto-finalize when gaze submitted second", async () => {
      const gazeData = createSampleGazeData();

      await program.methods
        .submitGazeAttestation(
          Array.from(gazeData.tensorHash),
          gazeData.cogVector,
          gazeData.emoVector,
          gazeData.envVector,
          new BN(gazeData.durationCs),
          gazeData.gazeEntropy
        )
        .accounts({
          user: user2.publicKey,
          handshake: handshakePDA,
          protocolConfig: protocolConfigPDA,
        })
        .signers([user2])
        .rpc();

      const handshake = await program.account.handshake.fetch(handshakePDA);

      expect(handshake.computeVerified).to.be.true;
      expect(handshake.gazeVerified).to.be.true;
      expect(handshake.attestationComplete).to.be.true;

      console.log("  Gaze submitted second - auto-finalized");
    });
  });

  // ==========================================================================
  // THRESHOLD ENFORCEMENT TESTS
  // ==========================================================================

  describe("Threshold Enforcement", () => {
    let handshakeId: Uint8Array;
    let handshakePDA: PublicKey;

    beforeEach(async () => {
      handshakeId = generateHandshakeId();
      [handshakePDA] = getHandshakePDA(user1.publicKey, handshakeId, programId);

      await program.methods
        .initiateHandshake(Array.from(handshakeId))
        .accounts({
          user: user1.publicKey,
          handshake: handshakePDA,
          protocolConfig: protocolConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();
    });

    it("should reject gaze duration below threshold", async () => {
      const gazeData = createSampleGazeData();
      gazeData.durationCs = 100; // Below 222 threshold

      try {
        await program.methods
          .submitGazeAttestation(
            Array.from(gazeData.tensorHash),
            gazeData.cogVector,
            gazeData.emoVector,
            gazeData.envVector,
            new BN(gazeData.durationCs),
            gazeData.gazeEntropy
          )
          .accounts({
            user: user1.publicKey,
            handshake: handshakePDA,
            protocolConfig: protocolConfigPDA,
          })
          .signers([user1])
          .rpc();

        expect.fail("Should have thrown InsufficientGazeDuration error");
      } catch (error: any) {
        expect(error.message).to.include("InsufficientGazeDuration");
        console.log("  Correctly rejected insufficient gaze duration");
      }
    });

    it("should reject compute difficulty below minimum", async () => {
      const computeProof = createSampleComputeProof();
      computeProof.difficulty = 0; // Below minimum of 1

      try {
        await program.methods
          .submitComputeProof(
            Array.from(computeProof.proofHash),
            computeProof.difficulty,
            computeProof.deviceType,
            computeProof.nonce,
            computeProof.computeEntropy
          )
          .accounts({
            user: user1.publicKey,
            handshake: handshakePDA,
            protocolConfig: protocolConfigPDA,
          })
          .signers([user1])
          .rpc();

        expect.fail("Should have thrown InsufficientDifficulty error");
      } catch (error: any) {
        expect(error.message).to.include("InsufficientDifficulty");
        console.log("  Correctly rejected insufficient difficulty");
      }
    });

    it("should reject zero entropy value", async () => {
      const gazeData = createSampleGazeData();
      gazeData.gazeEntropy = new BN(0); // Invalid entropy

      try {
        await program.methods
          .submitGazeAttestation(
            Array.from(gazeData.tensorHash),
            gazeData.cogVector,
            gazeData.emoVector,
            gazeData.envVector,
            new BN(gazeData.durationCs),
            gazeData.gazeEntropy
          )
          .accounts({
            user: user1.publicKey,
            handshake: handshakePDA,
            protocolConfig: protocolConfigPDA,
          })
          .signers([user1])
          .rpc();

        expect.fail("Should have thrown InvalidEntropy error");
      } catch (error: any) {
        expect(error.message).to.include("InvalidEntropy");
        console.log("  Correctly rejected zero entropy");
      }
    });
  });

  // ==========================================================================
  // AUTHORIZATION TESTS
  // ==========================================================================

  describe("Authorization", () => {
    let handshakeId: Uint8Array;
    let handshakePDA: PublicKey;

    before(async () => {
      handshakeId = generateHandshakeId();
      [handshakePDA] = getHandshakePDA(user1.publicKey, handshakeId, programId);

      await program.methods
        .initiateHandshake(Array.from(handshakeId))
        .accounts({
          user: user1.publicKey,
          handshake: handshakePDA,
          protocolConfig: protocolConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();
    });

    it("should reject gaze submission from wrong user", async () => {
      const gazeData = createSampleGazeData();

      try {
        await program.methods
          .submitGazeAttestation(
            Array.from(gazeData.tensorHash),
            gazeData.cogVector,
            gazeData.emoVector,
            gazeData.envVector,
            new BN(gazeData.durationCs),
            gazeData.gazeEntropy
          )
          .accounts({
            user: user2.publicKey, // Wrong user!
            handshake: handshakePDA,
            protocolConfig: protocolConfigPDA,
          })
          .signers([user2])
          .rpc();

        expect.fail("Should have thrown UnauthorizedSigner error");
      } catch (error: any) {
        expect(error.message).to.include("UnauthorizedSigner");
        console.log("  Correctly rejected unauthorized gaze submission");
      }
    });

    it("should reject compute proof from wrong user", async () => {
      const computeProof = createSampleComputeProof();

      try {
        await program.methods
          .submitComputeProof(
            Array.from(computeProof.proofHash),
            computeProof.difficulty,
            computeProof.deviceType,
            computeProof.nonce,
            computeProof.computeEntropy
          )
          .accounts({
            user: user2.publicKey, // Wrong user!
            handshake: handshakePDA,
            protocolConfig: protocolConfigPDA,
          })
          .signers([user2])
          .rpc();

        expect.fail("Should have thrown UnauthorizedSigner error");
      } catch (error: any) {
        expect(error.message).to.include("UnauthorizedSigner");
        console.log("  Correctly rejected unauthorized compute submission");
      }
    });
  });

  // ==========================================================================
  // OPTX MINTING TESTS
  // ==========================================================================

  describe("OPTX Minting", () => {
    it("should reject minting more than allowance", async () => {
      const userEntropy = await program.account.userEntropy.fetch(
        user1EntropyPDA
      );
      const excessAmount = userEntropy.optxMintingAllowance.add(new BN(1));

      // Create user's OPTX token account
      const userOptxAccount = getAssociatedTokenAddressSync(
        optxMint,
        user1.publicKey,
        false,
        TOKEN_2022_PROGRAM_ID
      );

      // Create the associated token account if it doesn't exist
      try {
        const createAtaIx = createAssociatedTokenAccountInstruction(
          user1.publicKey,
          userOptxAccount,
          user1.publicKey,
          optxMint,
          TOKEN_2022_PROGRAM_ID
        );

        const tx = new anchor.web3.Transaction().add(createAtaIx);
        await provider.sendAndConfirm(tx, [user1]);
      } catch (e) {
        // ATA might already exist
      }

      try {
        await program.methods
          .mintOptx(excessAmount)
          .accounts({
            user: user1.publicKey,
            userEntropy: user1EntropyPDA,
            protocolConfig: protocolConfigPDA,
            optxMint: optxMint,
            userOptxAccount: userOptxAccount,
            tokenProgram: TOKEN_2022_PROGRAM_ID,
          })
          .signers([user1])
          .rpc();

        expect.fail("Should have thrown InsufficientAllowance error");
      } catch (error: any) {
        expect(error.message).to.include("InsufficientAllowance");
        console.log("  Correctly rejected minting beyond allowance");
      }
    });
  });

  // ==========================================================================
  // REVOCATION TESTS
  // ==========================================================================

  describe("Attestation Revocation", () => {
    let handshakeId: Uint8Array;
    let attestationPDA: PublicKey;

    before(async () => {
      // Use the attestation created in happy path tests
      handshakeId = generateHandshakeId();
      const [handshakePDA] = getHandshakePDA(
        user1.publicKey,
        handshakeId,
        programId
      );
      [attestationPDA] = getAttestationPDA(
        user1.publicKey,
        handshakeId,
        programId
      );

      // Create a new attestation for revocation testing
      await program.methods
        .initiateHandshake(Array.from(handshakeId))
        .accounts({
          user: user1.publicKey,
          handshake: handshakePDA,
          protocolConfig: protocolConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();

      const gazeData = createSampleGazeData();
      await program.methods
        .submitGazeAttestation(
          Array.from(gazeData.tensorHash),
          gazeData.cogVector,
          gazeData.emoVector,
          gazeData.envVector,
          new BN(gazeData.durationCs),
          gazeData.gazeEntropy
        )
        .accounts({
          user: user1.publicKey,
          handshake: handshakePDA,
          protocolConfig: protocolConfigPDA,
        })
        .signers([user1])
        .rpc();

      const computeProof = createSampleComputeProof();
      await program.methods
        .submitComputeProof(
          Array.from(computeProof.proofHash),
          computeProof.difficulty,
          computeProof.deviceType,
          computeProof.nonce,
          computeProof.computeEntropy
        )
        .accounts({
          user: user1.publicKey,
          handshake: handshakePDA,
          protocolConfig: protocolConfigPDA,
        })
        .signers([user1])
        .rpc();

      await program.methods
        .finalizeAttestation()
        .accounts({
          user: user1.publicKey,
          handshake: handshakePDA,
          attestation: attestationPDA,
          userEntropy: user1EntropyPDA,
          protocolConfig: protocolConfigPDA,
          systemProgram: SystemProgram.programId,
        })
        .signers([user1])
        .rpc();
    });

    it("should allow owner to revoke attestation", async () => {
      await program.methods
        .revokeAttestation()
        .accounts({
          authority: user1.publicKey, // Owner can revoke
          attestation: attestationPDA,
          protocolConfig: protocolConfigPDA,
        })
        .signers([user1])
        .rpc();

      const attestation = await program.account.attestation.fetch(
        attestationPDA
      );

      expect(attestation.isValid).to.be.false;
      expect(attestation.revokedAt).to.not.be.null;

      console.log("  Attestation revoked by owner");
    });

    it("should reject re-revocation of already revoked attestation", async () => {
      try {
        await program.methods
          .revokeAttestation()
          .accounts({
            authority: user1.publicKey,
            attestation: attestationPDA,
            protocolConfig: protocolConfigPDA,
          })
          .signers([user1])
          .rpc();

        expect.fail("Should have thrown AlreadyRevoked error");
      } catch (error: any) {
        expect(error.message).to.include("AlreadyRevoked");
        console.log("  Correctly rejected re-revocation");
      }
    });
  });

  // ==========================================================================
  // CONFIG UPDATE TESTS
  // ==========================================================================

  describe("Config Updates", () => {
    it("should allow authority to update config", async () => {
      const newGazeThreshold = 300; // 3 seconds

      await program.methods
        .updateConfig(new BN(newGazeThreshold), null, null, null)
        .accounts({
          authority: authority.publicKey,
          protocolConfig: protocolConfigPDA,
        })
        .signers([authority])
        .rpc();

      const config = await program.account.protocolConfig.fetch(
        protocolConfigPDA
      );
      expect(config.gazeThreshold.toNumber()).to.equal(newGazeThreshold);

      // Reset to default
      await program.methods
        .updateConfig(new BN(DEFAULT_GAZE_THRESHOLD), null, null, null)
        .accounts({
          authority: authority.publicKey,
          protocolConfig: protocolConfigPDA,
        })
        .signers([authority])
        .rpc();

      console.log("  Config updated by authority");
    });

    it("should reject config update from non-authority", async () => {
      try {
        await program.methods
          .updateConfig(new BN(500), null, null, null)
          .accounts({
            authority: user1.publicKey, // Not authority!
            protocolConfig: protocolConfigPDA,
          })
          .signers([user1])
          .rpc();

        expect.fail("Should have thrown UnauthorizedSigner error");
      } catch (error: any) {
        expect(error.message).to.include("UnauthorizedSigner");
        console.log("  Correctly rejected unauthorized config update");
      }
    });
  });

  // ==========================================================================
  // SUMMARY
  // ==========================================================================

  describe("Test Summary", () => {
    it("should display final protocol stats", async () => {
      const config = await program.account.protocolConfig.fetch(
        protocolConfigPDA
      );

      console.log("\n========================================");
      console.log("  PROTOCOL STATISTICS");
      console.log("========================================");
      console.log(`  Total Handshakes: ${config.totalHandshakes.toString()}`);
      console.log(`  Total Attestations: ${config.totalAttestations.toString()}`);
      console.log(`  Total OPTX Minted: ${config.totalOptxMinted.toString()}`);
      console.log(`  Gaze Threshold: ${config.gazeThreshold.toString()} cs`);
      console.log(`  Min Difficulty: ${config.computeDifficultyMin}`);
      console.log("========================================\n");
    });
  });
});
