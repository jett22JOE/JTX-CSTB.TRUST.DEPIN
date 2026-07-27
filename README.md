# jettoptx-poa-depin

**Canonical Solana programs for Jett Optics Proof-of-Attention (PoA) DePIN and the community vault.**

On-chain source of record for:

1. **PoA Trust** — gaze attestation handshakes, compute proofs, OPTX entropy accounting  
2. **Jett Vault** — community vault, AGT attestations, stake tiers, AARON audit stamps  

Stack: **Anchor 0.30.1** · **Solana mainnet-beta** (+ devnet test IDs) · **Apache-2.0**

| | |
|--|--|
| Site | [jettoptics.ai](https://jettoptics.ai) |
| Docs | [jettoptx-docs](https://github.com/jettoptx/jettoptx-docs) · [docs.jettoptx.dev](https://docs.jettoptx.dev) |
| Edge API | AARON Router ([private](https://github.com/jettoptx/jettoptx-aaron-router)) · public edge [aaron.jettoptics.ai](https://aaron.jettoptics.ai) |
| Product UI | [jettoptx.chat](https://jettoptx.chat) · [jtx.astroknots.space](https://jtx.astroknots.space) |

---

## Programs (live)

### Mainnet

| Role | On-disk crate / module* | Program ID | Explorer |
|------|-------------------------|------------|----------|
| **PoA Trust** | `programs/jtx-optx-devnet-poa-trustjoe` → `jtx_optx_devnet_poa_trustjoe` | `85sqs4upQiPrvk1NMuyfHVQoW1EGdgk8m2cQb7uMxXTF` | [view](https://explorer.solana.com/address/85sqs4upQiPrvk1NMuyfHVQoW1EGdgk8m2cQb7uMxXTF) |
| **Jett Vault** | `programs/jett-vault` → `jett_vault` | `JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7` | [view](https://explorer.solana.com/address/JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7) |

\*Renamed from historical `jtx_cstb_trust`. **Product scope is PoA / OPTX trust — not CompuStable / $CSTB.** See [Out of product scope](#out-of-product-scope).

### Devnet (`--features devnet`)

| Role | Program ID |
|------|------------|
| PoA Trust | `79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF` |
| Jett Vault | `ExjFkkX3Zogyb5uBeaff8FdKZbjjVHcCHgcaQiP3qQDS` |

Legacy program `91SqPNGRFrTgwSM3S7grZK8A6TCqn5STFGK4mAfqWMbQ` is **deprecated** (superseded by mainnet PoA Trust).

---

## Upgrade authority (audit-critical)

Both mainnet programs use the **Squads vault** as BPF upgrade authority. Upgrades require multisig approval — not a single hot wallet.

| Field | Value |
|-------|--------|
| **Upgrade authority** | `9WssADzftzptNnMHLzPZYAFApUfE7qLYChicH1Wh6YD7` |
| **Control** | Squads **2-of-3** multisig vault (treasury) |
| **PoA Trust status** | Transferred **2026-07-26** (was single-key `EFvg…`, retired) |
| **Jett Vault status** | Same Squads authority (already in place) |
| **Immutable?** | No — upgradeable under governance only |
| **Planned next** | Transfer to JOE wallet `GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq` (SNS `astro.knots.sol`) — local signing pending |

**Verify anytime:**

```bash
solana program show 85sqs4upQiPrvk1NMuyfHVQoW1EGdgk8m2cQb7uMxXTF --url mainnet-beta
# Authority: 9WssADzftzptNnMHLzPZYAFApUfE7qLYChicH1Wh6YD7

solana program show JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7 --url mainnet-beta
# Authority: 9WssADzftzptNnMHLzPZYAFApUfE7qLYChicH1Wh6YD7
```

**PoA authority transfer (record):**

| | |
|--|--|
| Tx | [`4PDYvJX1q1sFzc9SggFj6AR9UXsPyUkBxDwmZoJWi93udcWDE3viD9HGqUECQ97KSS9x58T636tuKTGVBrQWoks1`](https://explorer.solana.com/tx/4PDYvJX1q1sFzc9SggFj6AR9UXsPyUkBxDwmZoJWi93udcWDE3viD9HGqUECQ97KSS9x58T636tuKTGVBrQWoks1) |
| From | `EFvgELE1Hb4PC5tbPTAe8v1uEDGee8nwYBMCU42bZRGk` (retired ops key) |
| To | `9WssADzftzptNnMHLzPZYAFApUfE7qLYChicH1Wh6YD7` |

> **Mainnet deploy / upgrade policy:** never deploy from a personal keypair. Coordinate every bytecode change through Squads.

---

## Out of product scope

Be explicit with auditors and integrators:

| Topic | Status |
|-------|--------|
| **CompuStable / $CSTB** | **Not a product dependency.** Account field `cstb_mint` is a **legacy layout slot** written at `initialize`; it does not gate minting or prove an external PoW token. |
| **`submit_compute_proof`** | Stores a **caller-supplied opaque hash** + difficulty floor. It does **not** verify an external CompuStable network. |
| **Off-chain services** | AARON Router, MOJO, SpacetimeDB, marketing sites — separate repos / contracts unless scoped into the engagement. |
| **EVM Tempo wallet** | Settlement convenience only; not part of these Solana programs. |

---

## What these programs do

### PoA Trust (`jtx_optx_devnet_poa_trustjoe` module)

Gaze-centric attestation pipeline on Solana:

1. `initiate_handshake` — open time-bounded handshake  
2. `submit_gaze_attestation` — AGT tensor vectors + gaze proof hash (opaque; raw biometrics stay client-side)  
3. `submit_compute_proof` — opaque compute hash + difficulty  
4. `finalize_attestation` — permanent record + entropy / OPTX allowance accounting  
5. `mint_optx` — mint against accumulated allowance (when mint/config is live for that environment)

Also: config updates, pause, revoke, handshake close, attestation verify.

### Jett Vault (`jett_vault`)

Community vault + AGT surface:

- SOL / agent USDC contributions  
- AGT attestation create / weight update  
- Optional CPI link into PoA Trust  
- AARON operator audit hash (immutable once set)  
- Stake / subscription surfaces (prefer stake paths; some legacy ix may be fail-closed)  
- Refunds, pause (multisig-gated), donor NFT mint (mpl-core)

---

## Tokens (context)

| Token | Mint | Network | Notes |
|-------|------|---------|--------|
| **$JTX v2** (canonical) | `JTXGnx83s2QZ2MwYkRD1cBKrqQKSdG5oe8vSYW5Zjoe` | Mainnet | Token-2022, 9 decimals — **use this** |
| $JTX v1 (legacy) | `9XpJiKEYzq5yDo5pJzRfjSRMPL2yPfDQXgiN7uYtBhUj` | Mainnet | Mint authority **revoked** |
| $OPTX (devnet reward mint) | `DSyauRAZwUd2BrTk3P8k2yUxxvcx5X4BBg3Gh3VbeRG3` | Devnet | Gaze/attestation rewards in test environments |
| $CSTB | — | — | **Not product.** Ignore for audits and client integrations. |

**$JTX mint authority:** revoked (fixed supply).  
**Meteora DLMM (liquidity):** `54ecLhTa8HZg1bhcDNWiddd8p7UN7jq4HLWeLr1sRHMz`  
**Buy:** [jettoptics.ai/buy](https://jettoptics.ai/buy)

---

## System context (off-chain)

```text
MOJO / Web  →  JETT Auth (AGT client)  →  AARON Router (edge)
                                              │
                    opaque proofs / x402  ─────┤
                                              ▼
                                    Solana mainnet
                              PoA Trust  +  Jett Vault
                                              │
                                         SpacetimeDB / ops
```

| Name | Role |
|------|------|
| **JETT Auth** | Client-side gaze / biometric proof hashing |
| **AARON** | Edge router: verification, payments, DePIN APIs |
| **AGT** | COG / EMO / ENV tensor representation of attention |
| **JOE** | Operator agent (Hermes / Grok) — not an on-chain program |
| **OPTX** | Token + protocol network branding |

Biometric **raw data never goes on-chain** — only 32-byte opaque hashes and fixed-point tensor fields.

---

## Instructions (summary)

### PoA Trust

| Instruction | Description |
|-------------|-------------|
| `initialize` | Protocol config + mint wiring |
| `update_config` | Authority updates parameters |
| `create_user_entropy` | Per-user entropy account |
| `initiate_handshake` | Start handshake (expiry) |
| `submit_gaze_attestation` | AGT gaze proof |
| `submit_compute_proof` | Opaque compute hash + difficulty |
| `finalize_attestation` | Finalize + entropy / allowance |
| `mint_optx` | Mint against allowance |
| `verify_attestation` / `revoke_attestation` | Validity controls |
| `close_handshake` | Rent reclaim |
| `set_paused` | Emergency pause |

### Jett Vault

| Instruction | Description |
|-------------|-------------|
| `initialize_vault` | Goal, deadlines, multisig roster |
| `donate_sol` / `donate_usdc_agent` | Contributions |
| `create_agt_attestation` / `update_agt_weights` | AGT state |
| `link_attestation` | CPI toward PoA Trust |
| `aaron_audit` | Operator risk / audit hash |
| `stake_for_tier` (preferred) / legacy subscription paths | Access tiers |
| `mint_optx` / `claim_refund` / `set_paused` / `mint_donor_nft` | Vault lifecycle |

Exact accounts and constraints: see program sources under `programs/` and the TypeScript SDK under `sdk/`.

---

## Account sketches

### ProtocolConfig (PDA `"protocol-config"`)

```rust
pub struct ProtocolConfig {
    pub authority: Pubkey,
    pub jtx_mint: Pubkey,
    pub cstb_mint: Pubkey,   // legacy layout slot — unused for product gating
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

### Handshake (PDA `"handshake" + user + handshake_id`)

Gaze vectors, compute proof hash, entropy fields, `finalized` / `claimed` flags — see `programs/jtx-optx-devnet-poa-trustjoe/src/lib.rs`.

### AgtAttestation (vault)

Fixed-point COG/EMO/ENV weights, tensor / attestation hashes, optional immutable `aaron_audit_hash`, risk score — see `programs/jett-vault/src/lib.rs`.

---

## AGT (brief)

| Axis | Meaning |
|------|---------|
| **COG** | Cognitive / upper attention |
| **EMO** | Affective / lower-left |
| **ENV** | Environmental / lower-right |

Weights are projected onto the simplex (sum ≈ 1). Adaptive update:

```text
w(t+1) = simplex_project[(1 - α) · w(t) + α · g(t)]
```

Entropy of the weight distribution feeds attestation strength / allowance math (see program constants).

---

## Development

### Prerequisites

- Rust 1.75+  
- Solana CLI 1.18+  
- Anchor 0.30.1+  
- Node.js 18+  

### Build

```bash
yarn install

# Mainnet-shaped IDs (default declare_id!)
anchor build -p jtx-optx-devnet-poa-trustjoe
anchor build -p jett-vault

# Devnet IDs
anchor build -p jett-vault -- --features devnet
anchor build -p jtx-optx-devnet-poa-trustjoe -- --features devnet   # if feature-gated in crate
```

### Test

```bash
anchor test
```

### Deploy / upgrade

```bash
# Devnet only without Squads
solana config set --url devnet
anchor deploy --provider.cluster devnet

# Mainnet: Squads-only process for upgrades
# Do not use a personal keypair as upgrade authority.
```

---

## SDK

| Module | Role |
|--------|------|
| `sdk/jett-sdk.ts` | AGT / biometric proof / AARON risk helpers |
| `sdk/trust-client.ts` | Anchor client for PoA Trust program |
| `sdk/vault-client.ts` | Anchor client for Jett Vault |

```typescript
import { BiometricProof, AgtTensor, AaronRisk } from './sdk/jett-sdk'

const tensor = AgtTensor.fromGaze(cogValue, envValue, emoValue)
const proof = BiometricProof.generate(tensor, entropy)
const proofHash = proof.hash() // 32-byte opaque hash only on-chain
```

---

## Security posture

### Engineering controls (in program design)

- Checked arithmetic / overflow guards  
- Double-mint and double-finalize guards  
- Handshake claim / replay flags  
- Pause switches  
- Opaque biometric hashes only  
- AARON audit hash write-once behavior  
- Vault multisig roster for sensitive vault ops  
- No private keys in this repository  

### Governance controls (mainnet)

- **BPF upgrade authority = Squads vault `9Wss…` (2-of-3)**  
- Retired single-key upgrade authority (`EFvg…`)  

### Audit trail (internal / pre-engagement)

| Version | Date | Notes |
|---------|------|--------|
| v2.0.0 | 2026-01-30 | Internal security pass |
| v2.1.x | 2026-02 → 05 | Pre-mainnet + mainnet deploy review |
| v2.2.0 | 2026-07-26 | Upgrade authority → Squads treasury (PoA) |

For third-party engagements (e.g. Assure DeFi): freeze a **git tag + commit SHA**, publish IDL / verifiable builds, and attach this README + program sources. Audit brief: [`docs/AUDIT.md`](docs/AUDIT.md).

---

## Mainnet checklist

- [x] PoA Trust deployed (`85sqs…xXTF`)  
- [x] Jett Vault deployed (`JTX5…EYA7`)  
- [x] $JTX v2 live; mint authority revoked  
- [x] Meteora pool seeded / LP locked (see trading runbooks)  
- [x] Treasury / Squads vault `9Wss…` as operational treasury  
- [x] **Upgrade authority → Squads `9Wss…` for both programs**  
- [x] TypeScript SDK present  
- [ ] External audit engagement (Assure DeFi or equivalent) — freeze tag  
- [ ] Verifiable build artifacts published for freeze SHA  
- [ ] First mainnet gaze attestation + OPTX path (product)  

---

## Repository layout

```text
programs/jtx-optx-devnet-poa-trustjoe/   # PoA Trust (legacy crate name)
programs/jett-vault/       # Community vault + AGT
crates/shared-constants/   # Shared IDs / constants
sdk/                       # TypeScript clients
tests/                     # Anchor / bankrun tests
scripts/                   # Deploy / init helpers
docs/                      # Design + handoff notes
```

---

## Links

| Resource | URL |
|----------|-----|
| Jett Optics | https://jettoptics.ai |
| Buy $JTX | https://jettoptics.ai/buy |
| Docs repo | https://github.com/jettoptx/jettoptx-docs |
| Developer docs | https://docs.jettoptx.dev |
| JettChat / DOJO | https://jettoptx.chat |
| AARON (edge) | https://aaron.jettoptics.ai |
| $JTX v2 Solscan | https://solscan.io/token/JTXGnx83s2QZ2MwYkRD1cBKrqQKSdG5oe8vSYW5Zjoe |
| Meteora pool | https://app.meteora.ag/dlmm/54ecLhTa8HZg1bhcDNWiddd8p7UN7jq4HLWeLr1sRHMz |
| PoA program | https://explorer.solana.com/address/85sqs4upQiPrvk1NMuyfHVQoW1EGdgk8m2cQb7uMxXTF |
| Vault program | https://explorer.solana.com/address/JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7 |

---

## License

MIT — see [LICENSE](LICENSE) if present; otherwise MIT as declared in crate manifests.

## Contact

**Joshua Martinez** — [joe@jettoptics.ai](mailto:joe@jettoptics.ai)  
**X:** [@jettoptx](https://x.com/jettoptx)
