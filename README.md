# JTX-CSTB Trust Protocol

**Verified Human-Compute Attestations on Solana**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Solana](https://img.shields.io/badge/Solana-Anchor%200.30-blue)](https://www.anchor-lang.com/)

A DePIN collaboration protocol that combines **JETT OPTICS** gaze-based Proof-of-Attention with **CompuStable's** computational proofs to create verified human-compute attestations on-chain. This protocol enables $JTX holders to mint **$OPTX** tokens through verified identity attestations.

## Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     JTX-CSTB Trust Protocol Flow                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│   User Holds $JTX ─────► Initiate Handshake                             │
│                                    │                                     │
│                          ┌─────────┴─────────┐                          │
│                          ▼                   ▼                          │
│               Submit Gaze Attestation   Submit Compute Proof            │
│               (AGT hash + vectors)      (CSTB hash + difficulty)        │
│                          │                   │                          │
│                          └─────────┬─────────┘                          │
│                                    │                                     │
│                                    ▼                                     │
│                          Finalize Attestation                           │
│                          (Create permanent record)                       │
│                                    │                                     │
│                                    ▼                                     │
│                          Combined Entropy ──► UserEntropy Account       │
│                                    │                                     │
│                                    ▼                                     │
│                          Entropy Unlocks ──► $OPTX Minting Allowance    │
│                                    │                                     │
│                                    ▼                                     │
│                          mint_optx() ──► User Receives $OPTX            │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Why This Matters

| Feature | Description |
|---------|-------------|
| **Anti-bot** | Real gaze patterns can't be spoofed by bots |
| **Anti-sybil** | Combines two independent verification mechanisms |
| **Cross-DePIN** | Creates interoperable attestations between networks |
| **Token Utility** | $JTX → attestation → $OPTX minting pathway |
| **Proof-of-Attention** | Rewards genuine human engagement |

## Token Ecosystem

| Token | Purpose | Contract |
|-------|---------|----------|
| **$JTX** | Ecosystem participation proof | `9XpJiKEYzq5yDo5pJzRfjSRMPL2yPfDQXgiN7uYtBhUj` (mainnet) |
| **$CSTB** | Computational proof minting | `4waAAfTjqf5LNpj2TC5zoeiAgegVwKWoy4WiJgjdBkVL` (devnet) |
| **$OPTX** | Attestation reward token | Token-2022 SPL (22M supply) |

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) 1.70+
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) 1.18+
- [Anchor](https://www.anchor-lang.com/docs/installation) 0.30+
- [Node.js](https://nodejs.org/) 18+
- [Yarn](https://yarnpkg.com/)

### Installation

```bash
# Clone repository
git clone https://github.com/jett22JOE/JTX-CSTB.TRUST.DEPIN
cd JTX-CSTB.TRUST.DEPIN

# Install dependencies
yarn install

# Build the program
anchor build

# Run tests
anchor test
```

### Deployment

```bash
# 1. Deploy $OPTX token (Token-2022)
yarn deploy-optx:devnet

# 2. Deploy the program
yarn deploy:devnet

# 3. Initialize the protocol
yarn initialize:devnet
```

## Account Structures

### ProtocolConfig (Global PDA)

| Field | Type | Description |
|-------|------|-------------|
| `authority` | Pubkey | Protocol admin |
| `jtx_mint` | Pubkey | $JTX token mint |
| `cstb_mint` | Pubkey | $CSTB token mint |
| `optx_mint` | Pubkey | $OPTX token mint |
| `total_handshakes` | u64 | Total handshakes initiated |
| `total_attestations` | u64 | Completed attestations |
| `total_optx_minted` | u64 | Total $OPTX minted |
| `gaze_threshold` | u64 | Min gaze duration (222 cs) |
| `compute_difficulty_min` | u8 | Min compute difficulty |
| `entropy_per_attestation` | u64 | Base entropy earned |
| `optx_per_entropy` | u64 | OPTX minting rate |

### Handshake (User PDA)

| Field | Type | Description |
|-------|------|-------------|
| `initiator` | Pubkey | User who initiated |
| `handshake_id` | [u8; 32] | Unique identifier |
| `initiated_at` | i64 | Start timestamp |
| `expires_at` | i64 | Expiry (1 hour) |
| `gaze_verified` | bool | Gaze attestation status |
| `gaze_tensor_hash` | [u8; 32] | AGT hash |
| `cog_vector` | [i16; 3] | Cognitive vector |
| `emo_vector` | [i16; 3] | Emotional vector |
| `env_vector` | [i16; 3] | Environmental vector |
| `gaze_entropy` | u64 | Entropy from gaze |
| `compute_verified` | bool | Compute proof status |
| `compute_proof_hash` | [u8; 32] | CSTB proof hash |
| `difficulty_level` | u8 | Proof difficulty |
| `device_type` | u8 | Device used |
| `compute_entropy` | u64 | Entropy from compute |

### Attestation (Permanent Record)

| Field | Type | Description |
|-------|------|-------------|
| `owner` | Pubkey | Attestation owner |
| `combined_hash` | [u8; 64] | gaze_hash \|\| compute_hash |
| `combined_entropy` | u64 | Total entropy |
| `optx_minted` | u64 | OPTX from this attestation |
| `is_valid` | bool | Validity status |
| `revoked_at` | Option<i64> | Revocation timestamp |

### UserEntropy (User PDA)

| Field | Type | Description |
|-------|------|-------------|
| `owner` | Pubkey | Account owner |
| `total_entropy` | u64 | Accumulated entropy |
| `entropy_used` | u64 | Entropy spent on minting |
| `attestation_count` | u64 | Number of attestations |
| `optx_minting_allowance` | u64 | Current mint allowance |

## Instructions

| Instruction | Description |
|-------------|-------------|
| `initialize` | Set up protocol config with token mints |
| `create_user_entropy` | Create entropy account for user |
| `initiate_handshake` | Start new attestation handshake |
| `submit_gaze_attestation` | Submit AGT hash + vectors |
| `submit_compute_proof` | Submit CSTB proof + difficulty |
| `finalize_attestation` | Create permanent attestation record |
| `mint_optx` | Mint $OPTX from entropy allowance |
| `verify_attestation` | Check attestation validity |
| `revoke_attestation` | Invalidate an attestation |
| `close_handshake` | Reclaim rent from expired handshake |

## TypeScript SDK

```typescript
import { TrustClient, createTrustClient } from "./sdk";

// Create client
const client = createTrustClient(connection, wallet);

// Create user entropy account
await client.createUserEntropy(userKeypair);

// Initiate handshake
const handshake = await client.initiateHandshake(userKeypair);

// Submit gaze attestation
await client.submitGazeAttestation(userKeypair, handshake.publicKey, {
  tensorHash: new Uint8Array(32).fill(0xAB),
  durationCs: 250,
  cogVector: [100, -50, 25],
  emoVector: [-30, 80, 10],
  envVector: [60, 40, -20],
  gazeEntropy: 1500n,
});

// Submit compute proof
await client.submitComputeProof(userKeypair, handshake.publicKey, {
  proofHash: new Uint8Array(32).fill(0xCD),
  difficulty: 2,
  deviceType: 2,
  nonce: 123456789n,
  computeEntropy: 1000n,
});

// Finalize and get attestation
const attestation = await client.finalizeAttestation(userKeypair, handshake.publicKey);

// Check minting allowance
const allowance = await client.getOptxMintingAllowance(userKeypair.publicKey);

// Mint OPTX
await client.mintOptx(userKeypair, allowance);
```

## Adaptive Gaze Tensors (AGT)

AGTs classify eye movements into three orthogonal vector spaces:

| Vector | Dimension | What It Measures |
|--------|-----------|------------------|
| **COG** | Cognitive | Visual search, decision-making, focus |
| **EMO** | Emotional | Saccade variations from emotional state |
| **ENV** | Environmental | Lighting, device, context adaptations |

**Key Properties**:
- Stored as 3x3 matrix of i16 values on-chain
- Hashed using SHA-256 for verification
- Minimum gaze duration: 222 centiseconds (2.22 seconds - "jett capture")
- Cryptographic implementation is proprietary (US Patent 19/243,050 pending)

## $OPTX Tokenomics

| Parameter | Value |
|-----------|-------|
| Total Supply | 22,000,000 $OPTX |
| Token Standard | Token-2022 SPL |
| Mint Authority | Protocol PDA |
| Entropy → OPTX Rate | Variable (difficulty-based) |
| Base Entropy/Attestation | 1,000 units |

### Staking Tiers (Future)

| Tier | Lock Period | Multiplier |
|------|-------------|------------|
| MOJO | 90 days | 1.0x |
| DOJO | 180 days | 1.5x |
| Founder | 365 days | 2.0x |

## Error Codes

| Error | Description |
|-------|-------------|
| `HandshakeExpired` | Handshake exceeded 1 hour |
| `InsufficientGazeDuration` | Gaze < 222 centiseconds |
| `InsufficientDifficulty` | Difficulty below minimum |
| `IncompleteAttestation` | Both proofs not verified |
| `UnauthorizedSigner` | Wrong signer |
| `InsufficientAllowance` | Not enough OPTX allowance |
| `InvalidEntropy` | Entropy must be > 0 |

## Security Considerations

- **Anti-replay**: Each handshake has a unique ID and 1-hour expiry
- **Checked arithmetic**: All operations use overflow-checked math
- **PDA derivation**: Deterministic addresses prevent spoofing
- **Authorization**: All operations verify signer identity
- **Entropy validation**: Prevents zero-entropy submissions

## Project Structure

```
JTX-CSTB.TRUST.DEPIN/
├── programs/
│   └── jtx-cstb-trust/
│       └── src/
│           └── lib.rs          # Solana program
├── sdk/
│   ├── index.ts                # SDK exports
│   └── trust-client.ts         # TypeScript client
├── tests/
│   └── jtx-cstb-trust.ts       # Test suite
├── scripts/
│   ├── deploy-optx.ts          # $OPTX token deployment
│   └── initialize.ts           # Protocol initialization
├── Anchor.toml                  # Anchor config
├── Cargo.toml                   # Rust workspace
├── package.json                 # Node dependencies
└── README.md                    # This file
```

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Run tests: `anchor test`
5. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) for details.

## Links

- **JETT OPTICS**: https://jettoptics.ai
- **CompuStable**: https://compustable.com
- **$JTX on Solscan**: https://solscan.io/token/9XpJiKEYzq5yDo5pJzRfjSRMPL2yPfDQXgiN7uYtBhUj

---

*Built with by JETT OPTICS x CompuStable*
