# JTX-CSTB Trust Protocol

**Verified Human-Compute Attestations on Solana**

[![Solana](https://img.shields.io/badge/Solana-Devnet-9945FF?style=flat&logo=solana)](https://explorer.solana.com/address/79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF?cluster=devnet)
[![Anchor](https://img.shields.io/badge/Anchor-0.30.1-blue)](https://anchor-lang.com)
[![License](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Security](https://img.shields.io/badge/Security-ASTRO.KNOTS%20Verified-brightgreen)](.)

## Devnet Deployment

| Field | Value |
|-------|-------|
| **Program ID** | `79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF` |
| **Network** | Solana Devnet |
| **Upgrade Authority** | `FEUwuvXbbSYTCEhhqgAt2viTsEnromNNDsapoFvyfy3H` |
| **JTX Vault (SOL)** | `3XZViWWRXEpQPkF3R1CBHuxqvuYgDW5fWPvbVHkCgGqq` |
| **Explorer** | [View on Solana Explorer](https://explorer.solana.com/address/79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF?cluster=devnet) |

---

## JOEclaw Earnings

JOEclaw (the autonomous agent) earns SOL through skill deployments and services. All earnings are deposited to the **JTX Vault**:

```
JTX Vault: 3XZViWWRXEpQPkF3R1CBHuxqvuYgDW5fWPvbVHkCgGqq
```

| Service | Rate | Recipient |
|---------|------|-----------|
| Vercel Deploy Skill | 0.08 SOL/deploy | JTX Vault |
| $JTX Holder Discount | FREE (hold 1 $JTX) | - |
| HEDGEHOG API calls | Pay-per-use | JTX Vault |

---

## Overview

JTX-CSTB Trust Protocol combines **JETT OPTICS** gaze-based Proof-of-Attention with **CompuStable's** computational proofs to create verified human-compute attestations on-chain. This enables $JTX holders to mint **$OPTX** tokens through verified identity attestations.

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
│               (AGT<>markov chain)       (CSTB hash + difficulty)        │
│                          │                   │                          │
│                          └─────────┬─────────┘                          │
│                                    │                                     │
│                                    ▼                                     │
│                          Finalize Attestation                           │
│                          (Create permanent record)                       │
│                                    │                                     │
│                                    ▼                                     │
│                          Combined Entropy ──► $OPTX Minting Allowance   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## AARON Protocol

**A**synchronous **A**udit **R**AG **O**ptical **N**ode

AARON is the audit trail protocol that ensures all AGT (Adaptive Gaze Tensor) attestations maintain integrity across the DePIN network:

### Core Principles

| Principle | Description |
|-----------|-------------|
| **Asynchronous** | Off-chain verification before on-chain submission |
| **Audit** | Complete trace of all gaze attestations via AGT<>markov chain proofs |
| **RAG** | Retrieval-Augmented Generation for historical pattern analysis |
| **Optical** | Cryptographic binding between gaze patterns and wallet identity |
| **Node** | DePIN mesh network for distributed attestation verification |

### AARON Flow Architecture

```
User Gaze Capture (COG/EMO/ENV)
         │
         ▼
┌─────────────────────────┐
│   HEDGEHOG MCP Server   │  ◄── Grok 4.1 Fast Reasoning
│   (Off-chain Verify)    │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│    AARON Audit Node     │  ◄── AGT<>Markov Chain Proofs
│   (Log & Validate)      │
└───────────┬─────────────┘
            │
            ▼
┌─────────────────────────┐
│   JTX-CSTB On-Chain     │  ◄── Solana Devnet
│   (Mint $OPTX)          │      79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF
└─────────────────────────┘
```

---

## JETT DePIN 4-Digit Tensor PIN

Users create a unique 4-position tensor PIN by selecting AGT regions:

| Tensor | Key | Emoji | Description |
|--------|-----|-------|-------------|
| **COG** | 1 | 🧠 | Cognitive - Visual search, decision-making, focus patterns |
| **EMO** | 2 | ❤️ | Emotional - Saccade variations from emotional state |
| **ENV** | 3 | 🌍 | Environmental - Lighting, device context, ambient factors |

**Example PIN:** `1321` = 🧠 → 🌍 → ❤️ → 🧠

This tensor PIN becomes part of the AGT<>markov chain proof for on-chain attestation and DePIN wallet binding.

---

## Token Ecosystem

| Token | Purpose | Contract |
|-------|---------|----------|
| **$JTX** | Ecosystem participation | `9XpJiKEYzq5yDo5pJzRfjSRMPL2yPfDQXgiN7uYtBhUj` (mainnet) |
| **$CSTB** | Computational proofs | `4waAAfTjqf5LNpj2TC5zoeiAgegVwKWoy4WiJgjdBkVL` (devnet) |
| **$OPTX** | Attestation rewards | Token-2022 SPL (22M supply) |

### $OPTX Minting Formula

```
optx_allowance = (gaze_entropy + compute_entropy) * difficulty * optx_per_entropy / 1000
```

---

## Protocol Instructions

| Instruction | Description |
|-------------|-------------|
| `initialize` | Initialize protocol with token mints and configuration |
| `create_user_entropy` | Create entropy tracking account for new user |
| `initiate_handshake` | Start new attestation handshake (1hr expiry) |
| `submit_gaze_attestation` | Submit AGT<>markov chain proof (COG/EMO/ENV vectors) |
| `submit_compute_proof` | Submit computational proof (CSTB hash + difficulty) |
| `finalize_attestation` | Combine proofs, create permanent record, calculate OPTX allowance |
| `mint_optx` | Mint $OPTX tokens based on accumulated entropy |
| `verify_attestation` | Check if attestation is valid |
| `revoke_attestation` | Invalidate an attestation |
| `close_handshake` | Reclaim rent after expiry/completion |
| `set_paused` | Emergency pause protocol (authority only) |

---

## Security Audit

**Auditor:** HEDGEHOG MCP - JOE Agentic Security Auditor
**Model:** Grok 4.1 Fast Reasoning
**Date:** 2026-01-30
**Status:** ASTRO.KNOTS Verified and Approved

### Security Fixes Applied (v2.0.0)

| Severity | Issue | Fix |
|----------|-------|-----|
| CRITICAL | Arithmetic overflow in allowance calc | u128 intermediate calculations |
| CRITICAL | Double-mint race condition | Deduct allowance BEFORE CPI |
| HIGH | Double-finalization | `finalized` flag check |
| HIGH | Replay attacks | `claimed` flag check |
| HIGH | No emergency stop | `paused` flag + `set_paused()` |
| MEDIUM | Entropy overflow | Cap at 1 billion |

---

## Development

### Prerequisites

- Rust 1.75+
- Solana CLI 1.18+
- Anchor 0.30.1+
- Node.js 18+

### Build & Deploy

```bash
# Clone repository
git clone https://github.com/jett22JOE/JTX-CSTB.TRUST.DEPIN.git
cd JTX-CSTB.TRUST.DEPIN

# Install dependencies
yarn install

# Build program
anchor build

# Configure Solana CLI for devnet
solana config set --url devnet
solana config set --keypair /path/to/keypair.json

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

---

## Integration

### Frontend SDK

```typescript
import {
  JTXCSTBClient,
  submitGazeAttestation,
  JTX_CSTB_PROGRAM_ID
} from '@/lib/solana/jtx-cstb-client'

// Program ID: 79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF

// Submit gaze attestation after HEDGEHOG verification
const result = await submitGazeAttestation(
  walletAddress,
  ['COG', 'ENV', 'EMO', 'COG'],   // 4-position gazeSequence
  [800, 900, 750, 850],           // holdDurations (ms)
  '1321',                          // tensorPIN encoding
  sessionNonce,
  signTransaction
)
```

### HEDGEHOG MCP Verification

```typescript
// Verify gaze pattern with HEDGEHOG (powered by Grok 4.1)
const response = await fetch('/api/hedgehog/gaze-verify', {
  method: 'POST',
  body: JSON.stringify({
    template: jouleTemplate,
    walletAddress: 'FEUwuvXbbSYTCEhhqgAt2viTsEnromNNDsapoFvyfy3H'
  })
})

// Response includes on-chain attestation data
const {
  onChainAttestation,
  programId,  // 79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF
  grokAnalysis
} = await response.json()
```

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
    pub gaze_threshold: u64,      // default: 222 cs (2.22 seconds)
    pub compute_difficulty_min: u8,
    pub entropy_per_attestation: u64,
    pub optx_per_entropy: u64,
    pub paused: bool,             // [SECURITY FIX]
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
    pub finalized: bool,          // [SECURITY FIX]
    pub claimed: bool,            // [SECURITY FIX]
    pub bump: u8,
}
```

---

## Related Projects

| Project | Description |
|---------|-------------|
| [v0-deploy-void-OPTX](https://github.com/jett22JOE/v0-deploy-void-OPTX) | Frontend with JETT gaze verification |
| HEDGEHOG MCP | Off-chain verification server (Grok 4.1) |
| CompuStable | Computational proof system |

---

## Links

- **JETT OPTICS**: https://jettoptics.ai
- **CompuStable**: https://compustable.com
- **$JTX on Solscan**: https://solscan.io/token/9XpJiKEYzq5yDo5pJzRfjSRMPL2yPfDQXgiN7uYtBhUj
- **Program on Explorer**: https://explorer.solana.com/address/79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF?cluster=devnet

---

## License

MIT License - See [LICENSE](LICENSE) for details.

---

## Contact

**Protocol:** JTX-CSTB Trust DePIN
**Founder:** Joshua Martinez (jOSH-cto)
**AI Assistant:** JOE (HEDGEHOG MCP + Grok 4.1 Fast Reasoning)

---

*ASTRO.KNOTS Verified and Approved*
