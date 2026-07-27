# Third-Party Audit Package — jettoptx-poa-depin

This repository is the **canonical Solana smart-contract source** for Jett Optics Proof-of-Attention (PoA) DePIN and the community vault. Use this document as the engagement brief for firms such as Assure DeFi.

## In-scope programs

| Program (crate / module) | Network | Program ID |
|--------------------------|---------|------------|
| `jtx_optx_devnet_poa_trustjoe` | **mainnet** | `85sqs4upQiPrvk1NMuyfHVQoW1EGdgk8m2cQb7uMxXTF` |
| `jtx_optx_devnet_poa_trustjoe` | devnet | `79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF` |
| `jett_vault` | **mainnet** | `JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7` |
| `jett_vault` | devnet | `ExjFkkX3Zogyb5uBeaff8FdKZbjjVHcCHgcaQiP3qQDS` |

Source roots:

- `programs/jtx-optx-devnet-poa-trustjoe/`
- `programs/jett-vault/`
- `crates/shared-constants/`

## Explicitly out of product scope

- **CompuStable / $CSTB** — not a product dependency. The on-chain account field `cstb_mint` is a **legacy layout slot** (written at `initialize`, unused for gating or mint verification).
- `submit_compute_proof` stores a **caller-supplied opaque hash** plus a difficulty floor. It does **not** verify an external PoW system or token balance.
- Off-chain services (AARON router, MOJO, SpacetimeDB, marketing sites) are **out of scope** unless separately contracted.

## Build & verify

```bash
# Mainnet-shaped binaries (default declare_id! values)
anchor build

# Devnet binaries (alternate program IDs)
anchor build -p jtx-optx-devnet-poa-trustjoe -- --features devnet
anchor build -p jett-vault -- --features devnet
```

Recommended for auditor reproducibility:

1. Pin the git commit SHA under review.
2. Produce verifiable builds (`solana-verify` / Anchor verifiable build) against the program IDs above.
3. Diff deployed bytecode to the SHA under review before signing off.

## Trust model notes (intentional)

| Surface | Behavior |
|---------|----------|
| Gaze attestation | Client-supplied AGT vectors + tensor hash; no on-chain biometric reconstruction |
| Compute proof | Opaque hash attestation + `compute_difficulty_min`; not CompuStable verification |
| OPTX mint | Gated by finalized attestation / entropy accounting and pause flag |
| Vault stake tiers | On-chain stake transfers replace deprecated honor-system `set_subscription` |
| AARON audit | Operator-supplied risk scores; `aaron_operator` must be in `multisig_signers` |
| Phase-2 stubs | `check_and_launch`, `trigger_refunds`, `update_phase`, `close_vault`, `migrate_from_legacy` return `VaultError::Deprecated` |

## Deprecated / fail-closed instructions

- `set_subscription` → `VaultError::Deprecated` (use `stake_for_tier`)
- Phase-2 stubs listed above → `VaultError::Deprecated`
- `JoeAutonomous` signers constrained to vault authority or multisig roster

## Related tokens (context only)

| Token | Mint | Notes |
|-------|------|-------|
| $JTX v2 | `JTXGnx83s2QZ2MwYkRD1cBKrqQKSdG5oe8vSYW5Zjoe` | Canonical Token-2022 mainnet |
| $OPTX | `DSyauRAZwUd2BrTk3P8k2yUxxvcx5X4BBg3Gh3VbeRG3` | Devnet reward mint (Token-2022) |
| $SGL | external | x402 compute micropayments — not deployed from this repo |

## Upgrade authority (live)

| Program | Upgrade authority |
|---------|-------------------|
| PoA Trust `85sqs…` | `9WssADzftzptNnMHLzPZYAFApUfE7qLYChicH1Wh6YD7` (treasury / Squads vault) |
| `jett_vault` `JTX5u…` | `9WssADzftzptNnMHLzPZYAFApUfE7qLYChicH1Wh6YD7` |

**Planned next (local signing):** `GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq` (SNS `astro.knots.sol`).

## Mainnet PoA Trust config

- Program deployed at `85sqs…`
- `protocol-config` PDA `DSzQkiU8rx6XAkRYQDcgCibrdCdG5Yt5Hv7EXmKXkgqf` — **not initialized** on mainnet
- Live initialized config is on **devnet** `79nQ…`

## Checklist before engagement

- [x] Freeze commit SHA + tag (see git tag `audit-assure-2026-07-27` after merge)
- [ ] Publish IDL + verifiable build artifacts for both programs
- [x] Document upgrade authority (`9Wss…`; planned `GtAkS5tY…`)
- [x] Document mainnet trust config PDA initialization state (uninitialized)
- [x] Provide this `docs/AUDIT.md` + `README.md` + program sources to the firm
