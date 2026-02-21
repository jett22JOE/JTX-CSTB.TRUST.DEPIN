# Astro Knots -- Spatial Encryption on Solana

[![Solana](https://img.shields.io/badge/Solana-Devnet-9945FF?style=flat&logo=solana)](https://explorer.solana.com/address/79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF?cluster=devnet)
[![Anchor](https://img.shields.io/badge/Anchor-0.30.1-blue)](https://anchor-lang.com)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Security](https://img.shields.io/badge/Security-ASTRO.KNOTS%20Verified-brightgreen)](.)

## Live

- [astroknots.space](https://astroknots.space) -- Community Vault
- [astro.knots.sol](https://astroknots.space) -- SNS V2 Domain
- [jettoptics.ai](https://jettoptics.ai) -- Main Site + DOJO

---

## Programs

| Program | ID | Network | Status |
|---------|----|---------|--------|
| `jtx_cstb_trust` | `79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF` | Devnet | Deployed |
| `jett_vault` | TBD | Devnet | In Development |

---

## Architecture Overview

The JTX-CSTB Trust Protocol uses AGT (Adaptive Gaze Tensor) attestations with biometric proof hashing. The protocol combines gaze-based Proof-of-Attention with computational proofs to create verified human-compute attestations on-chain. `$JTX` holders can mint `$OPTX` through verified identity attestations.

### Key Concepts

- **Biometric proof hashing** -- opaque 32-byte proofs computed client-side; only the hash is stored on-chain
- **AGT tensor math** -- `w(t+1) = projection[(1 - alpha) * w(t) + alpha * g(t)]`
- **Token-2022 standard** for all tokens
- **Non-custodial vault** with on-chain refund mechanism

### Protocol Flow

```
User Holds $JTX ------> Initiate Handshake
                                |
                    +-----------+-----------+
                    v                       v
          Submit Gaze Attestation   Submit Compute Proof
          (AGT tensor vectors)      (CSTB hash + difficulty)
                    |                       |
                    +-----------+-----------+
                                |
                                v
                      Finalize Attestation
                      (Create permanent record)
                                |
                                v
                    Combined Entropy ----> $OPTX Minting Allowance
```

---

## Token Ecosystem

| Token | Mint | Purpose |
|-------|------|---------|
| `$JTX` | `9XpJiKEYzq5yDo5pJzRfjSRMPL2yPfDQXgiN7uYtBhUj` | Governance + staking |
| `$OPTX` | Token-2022 SPL (devnet) | Gaze attestation rewards |
| `$CSTB` | `4waAAfTjqf5LNpj2TC5zoeiAgegVwKWoy4WiJgjdBkVL` (devnet) | DePIN validator token |

### $OPTX Minting Formula

```
optx_allowance = (gaze_entropy + compute_entropy) * difficulty * optx_per_entropy / 1000
```

---

## JTX Community Vault

| Detail | Value |
|--------|-------|
| **Goal** | 5,874 SOL (~$781K at $133/SOL) |
| **Phase 1** | 2x OPTX multiplier (ends March 31, 2026) |
| **Phase 2** | 1x OPTX standard (April -- June 2026) |
| **Custody** | Non-custodial -- full refund if goal not met |
| **Live at** | [astroknots.space](https://astroknots.space) |

---

## Protocol Instructions

| Instruction | Description |
|-------------|-------------|
| `initialize` | Initialize protocol with token mints and configuration |
| `create_user_entropy` | Create entropy tracking account for new user |
| `initiate_handshake` | Start new attestation handshake (1hr expiry) |
| `submit_gaze_attestation` | Submit AGT tensor proof (COG/EMO/ENV vectors) |
| `submit_compute_proof` | Submit computational proof (CSTB hash + difficulty) |
| `finalize_attestation` | Combine proofs, create permanent record, calculate OPTX allowance |
| `mint_optx` | Mint $OPTX tokens based on accumulated entropy |
| `verify_attestation` | Check if attestation is valid |
| `revoke_attestation` | Invalidate an attestation |
| `close_handshake` | Reclaim rent after expiry/completion |
| `set_paused` | Emergency pause protocol (authority only) |

---

## Account Structures

### ProtocolConfig (PDA: `"protocol-config"`)

```rust
pub struct ProtocolConfig {
    pub authority: Pubkey,
    pub jtx_mint: Pubkey,
    pub cstb_mint: Pubkey,
    pub optx_mint: Pubkey,
    pub total_handshakes: u64,
    pub total_attestations: u64,
    pub total_optx_minted: u64,
    pub gaze_threshold: u64,
    pub compute_difficulty_min: u8,
    pub entropy_per_attestation: u64,
    pub optx_per_entropy: u64,
    pub paused: bool,
    pub bump: u8,
}
```

### Handshake (PDA: `"handshake" + user + handshake_id`)

```rust
pub struct Handshake {
    pub initiator: Pubkey,
    pub handshake_id: [u8; 32],
    pub expires_at: i64,
    pub gaze_verified: bool,
    pub gaze_tensor_hash: [u8; 32],
    pub cog_vector: [i16; 3],
    pub emo_vector: [i16; 3],
    pub env_vector: [i16; 3],
    pub gaze_entropy: u64,
    pub compute_verified: bool,
    pub compute_proof_hash: [u8; 32],
    pub difficulty_level: u8,
    pub compute_entropy: u64,
    pub finalized: bool,
    pub claimed: bool,
    pub bump: u8,
}
```

---

## Development

### Prerequisites

- Rust 1.75+
- Solana CLI 1.18+
- Anchor 0.30.1+
- Node.js 18+

### Build

```bash
# Install dependencies
yarn install

# Build programs
anchor build -p jtx-cstb-trust
anchor build -p jett-vault
```

### Test

```bash
anchor test
```

### Deploy

```bash
solana config set --url devnet
anchor deploy --provider.cluster devnet
```

---

## SDK

Two TypeScript SDKs are available for integration:

### Vault Client (`sdk/vault-client.ts`)

Anchor program client for the `jett_vault` program. Handles vault deposits, withdrawals, and refund logic.

### JETT SDK (`sdk/jett-sdk.ts`)

Core utilities for working with the protocol:

- `BiometricProof` class -- construct and hash biometric attestation proofs
- AGT tensor utilities -- vector math for COG/EMO/ENV tensors
- Handshake helpers -- initiate, submit, and finalize attestation flows

```typescript
import { BiometricProof, AGTensor } from './sdk/jett-sdk'

// Create a biometric proof (computed client-side, only hash goes on-chain)
const proof = new BiometricProof(cogVector, emoVector, envVector)
const proofHash = proof.hash() // 32-byte opaque hash
```

---

## Security

- No private keys stored in repository
- Biometric proofs are opaque hashes -- real computation stays client-side
- Admin operations gated by founder wallet
- Overflow protection on all arithmetic (u128 intermediate calculations)
- Double-mint prevention -- allowance deducted before CPI
- Double-finalization guard via `finalized` flag
- Replay attack protection via `claimed` flag
- Emergency pause mechanism (`set_paused` instruction)
- Reentrancy guards via Anchor defaults
- Security audit: ASTRO.KNOTS Verified

---

## Links

- **JETT OPTICS**: [jettoptics.ai](https://jettoptics.ai)
- **Developer Docs**: [jettoptics.ai/docs](https://jettoptics.ai/docs)
- **DOJO**: [jettoptics.ai/dojo](https://jettoptics.ai/dojo)
- **$JTX on Solscan**: [solscan.io](https://solscan.io/token/9XpJiKEYzq5yDo5pJzRfjSRMPL2yPfDQXgiN7uYtBhUj)
- **Program on Explorer**: [explorer.solana.com](https://explorer.solana.com/address/79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF?cluster=devnet)

---

## License

MIT License -- See [LICENSE](LICENSE) for details.

---

## Contact

**Joshua Martinez** -- [founder@jettoptics.ai](mailto:founder@jettoptics.ai)
**X**: [@jettoptx](https://x.com/jettoptx)
