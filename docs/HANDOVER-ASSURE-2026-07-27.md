# Assure DeFi Handover — Jett Optics PoA / Vault (ready to go)

**Date:** 2026-07-27 (America/Denver)  
**Engagement freeze:** tag [`audit-assure-2026-07-27`](https://github.com/jettoptx/jettoptx-poa-depin/releases/tag/audit-assure-2026-07-27) @ `71eb004d1cd6cd474c62c575db68b9496b9da86b`  
**Brief:** [`docs/AUDIT.md`](AUDIT.md)  
**Repo:** https://github.com/jettoptx/jettoptx-poa-depin  

This document is the **post-authority-transfer** handover for Assure. On-chain upgrade authority for both in-scope mainnet programs is live under **NEW_JOE**. Programs are **not immutable**.

---

## 1. Executive status

| Item | Status |
|------|--------|
| Source freeze tag | Ready — `audit-assure-2026-07-27` |
| In-scope programs | PoA Trust + Jett Vault (mainnet IDs below) |
| BPF upgrade authority | **Transferred** → `GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq` |
| Immutable | **No** (upgradeable; authority is explicit pubkey) |
| Mainnet PoA `protocol-config` PDA | **Uninitialized** (documented intentional state) |
| IDL / verifiable builds | Still open checklist item (see AUDIT.md) |

**Verdict for Assure kickoff:** governance/authority story is settled and verified on mainnet-beta. Review can proceed against the freeze tag + live program IDs.

---

## 2. In-scope program IDs (mainnet-beta ONLY)

| Program | Crate / module | Program ID | Explorer |
|---------|----------------|------------|----------|
| PoA Trust | `jtx_optx_devnet_poa_trustjoe` | `85sqs4upQiPrvk1NMuyfHVQoW1EGdgk8m2cQb7uMxXTF` | [link](https://explorer.solana.com/address/85sqs4upQiPrvk1NMuyfHVQoW1EGdgk8m2cQb7uMxXTF) |
| Jett Vault | `jett_vault` | `JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7` | [link](https://explorer.solana.com/address/JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7) |

**ProgramData accounts (for authority verification):**

| Program | ProgramData |
|---------|-------------|
| PoA Trust | `J1wW1fm5ecKRrmkZK2XmZYaEPg3Y6sqweqikBzTDNZnj` |
| Jett Vault | `8ZbXqDyY1ivLiLHJHgMBfZutvyT1y92i96nGRvnMpb7e` |

Source roots: `programs/jtx-optx-devnet-poa-trustjoe/`, `programs/jett-vault/`, `crates/shared-constants/`.

---

## 3. Live upgrade authority (verified 2026-07-27)

| Field | Value |
|-------|--------|
| **Live authority** | `GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq` |
| **Label** | NEW_JOE (ops) |
| **SNS** | `astro.knots.sol` |
| **Applies to** | Both PoA Trust and Jett Vault |
| **Authority option** | `Some(pubkey)` — **not** `None` / immutable |

### Reproduce (read-only)

```bash
solana program show 85sqs4upQiPrvk1NMuyfHVQoW1EGdgk8m2cQb7uMxXTF --url mainnet-beta
# expect Authority: GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq

solana program show JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7 --url mainnet-beta
# expect Authority: GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq
```

---

## 4. Authority history (audit trail)

| When | Action | From → To | Evidence |
|------|--------|-----------|----------|
| 2026-07-26 | PoA Trust upgrade authority transfer | `EFvgELE1Hb4PC5tbPTAe8v1uEDGee8nwYBMCU42bZRGk` → `9WssADzftzptNnMHLzPZYAFApUfE7qLYChicH1Wh6YD7` | Tx [`4PDYvJX1…`](https://explorer.solana.com/tx/4PDYvJX1q1sFzc9SggFj6AR9UXsPyUkBxDwmZoJWi93udcWDE3viD9HGqUECQ97KSS9x58T636tuKTGVBrQWoks1) |
| 2026-07-27 | PoA + Vault batch upgrade authority transfer | `9Wss…` → `GtAk…` | Squads v4 **tx index 63** (below) |

`EFvg…` is a **retired** ops key (post SHIELD 2026-07-15). Do not treat it as live upgrade authority.

---

## 5. Squads execution record (2026-07-27)

Transfer was **not** a raw single-key CLI call against a hot `9Wss` keyfile.  
`9WssADzftzptNnMHLzPZYAFApUfE7qLYChicH1Wh6YD7` is the **Squads v4 vault PDA** (index 0) for multisig `97e8mY66StgYXRuK7Je2t9RAbfosozauSo9avjZzY4GA`.

| Field | Value |
|-------|--------|
| Multisig | `97e8mY66StgYXRuK7Je2t9RAbfosozauSo9avjZzY4GA` |
| Vault PDA | `9WssADzftzptNnMHLzPZYAFApUfE7qLYChicH1Wh6YD7` |
| Threshold | 2 |
| Transaction index | **63** |
| Proposal PDA | `JDipjwk7zMsVeanzXBNrbJNJxDYQCfir5ZLugtbafYyk` |
| Proposal status | **Executed** |
| Approvers | `FEUwuvXbbSYTCEhhqgAt2viTsEnromNNDsapoFvyfy3H` (Founder), `GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq` (NEW_JOE) |
| Inner instructions | Two BPF Loader `SetAuthority` → `Some(GtAk…)` |

### Signatures

| Step | Signature |
|------|-----------|
| `vaultTransactionCreate` | [`632aEo2F6tmigH45SGJ6bvCh57NgSFRc2agpnpREfmYBWUcFQqpAtLdJAX31kju5cZo44EWSUDWnYAPJYxd177GM`](https://explorer.solana.com/tx/632aEo2F6tmigH45SGJ6bvCh57NgSFRc2agpnpREfmYBWUcFQqpAtLdJAX31kju5cZo44EWSUDWnYAPJYxd177GM) |
| `proposalCreate` | [`2JxbjUMqDZFSyaQrS7nDKHy5Z7dq5ni11RTGGibz1eCHZpkiiVxLEAK191fQ5cw9VPzQBNexdaVh78LDpGJhxVhM`](https://explorer.solana.com/tx/2JxbjUMqDZFSyaQrS7nDKHy5Z7dq5ni11RTGGibz1eCHZpkiiVxLEAK191fQ5cw9VPzQBNexdaVh78LDpGJhxVhM) |
| Founder approve | [`5oQtJC7xvgdXueqPwmrjLki3WsqkPBp5xJ6Rrvw3yyvYUyaWaUsVfJMkYxATYTfu5URM377aDdwqbp5ZRfFkuDdc`](https://explorer.solana.com/tx/5oQtJC7xvgdXueqPwmrjLki3WsqkPBp5xJ6Rrvw3yyvYUyaWaUsVfJMkYxATYTfu5URM377aDdwqbp5ZRfFkuDdc) |
| NEW_JOE approve (prop PDA) | [`4hDESEfxxfrJ7M4d1NiFd914FADrcSqzLkyN93wN84rPRkdxB1YKh5tcZEix7FxxDiTTXFHTN9mSD9dNMWMXoxLk`](https://explorer.solana.com/tx/4hDESEfxxfrJ7M4d1NiFd914FADrcSqzLkyN93wN84rPRkdxB1YKh5tcZEix7FxxDiTTXFHTN9mSD9dNMWMXoxLk) |
| **Execute (authorities applied)** | [`4MHKdACGdMXB6HmFGUdPMx6SVvMRy9fZx4HoXqSVF9HpQgFMdCs7GEay8LKYbfEKMGaXYy8kWAjSAia2kqoDsGEq`](https://explorer.solana.com/tx/4MHKdACGdMXB6HmFGUdPMx6SVvMRy9fZx4HoXqSVF9HpQgFMdCs7GEay8LKYbfEKMGaXYy8kWAjSAia2kqoDsGEq) |

Execute logs (slot `435610327`) include:

```
New authority Some(GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq)
New authority Some(GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq)
```

(one for each program’s ProgramData account)

---

## 6. Related addresses (context — not all in BPF scope)

| Role | Address | Notes |
|------|---------|--------|
| NEW_JOE / upgrade authority | `GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq` | `astro.knots.sol` |
| Squads vault / treasury | `9WssADzftzptNnMHLzPZYAFApUfE7qLYChicH1Wh6YD7` | `spacecowboys.sol`; still treasury / NFT authorities as applicable |
| Squads multisig | `97e8mY66StgYXRuK7Je2t9RAbfosozauSo9avjZzY4GA` | Owner program `SQDS4ep65T869zMMBKyuUq6aD6EgTu8psMjkvj52pCf` |
| Founder | `FEUwuvXbbSYTCEhhqgAt2viTsEnromNNDsapoFvyfy3H` | Squads member; approved tx 63 |
| Retired ops key | `EFvgELE1Hb4PC5tbPTAe8v1uEDGee8nwYBMCU42bZRGk` | Do not use |
| $JTX v2 mint | `JTXGnx83s2QZ2MwYkRD1cBKrqQKSdG5oe8vSYW5Zjoe` | Token-2022; context only |

---

## 7. Explicitly out of product / audit product scope

From [`AUDIT.md`](AUDIT.md) (unchanged intent):

- **CompuStable / $CSTB** — not a product dependency; `cstb_mint` is a legacy layout slot.
- `submit_compute_proof` — opaque caller hash + difficulty floor; not external PoW verification.
- Off-chain services (AARON router, MOJO, SpacetimeDB, marketing sites) — out of scope unless separately contracted.

---

## 8. What Assure should do first

1. Clone freeze tag `audit-assure-2026-07-27` @ `71eb004…`.
2. Read [`AUDIT.md`](AUDIT.md) + this handover + README upgrade-authority section.
3. Run `solana program show` for both program IDs; confirm authority `GtAk…`.
4. Optionally pull execute tx `4MHKdACG…` and confirm dual `New authority Some(GtAk…)`.
5. Build with Anchor per AUDIT.md; plan verifiable build / bytecode diff (checklist item still open).
6. Treat mainnet PoA `protocol-config` PDA as **uninitialized** unless/until separately initialized under current authority.

---

## 9. Operational notes for future upgrades

- To upgrade bytecode: buffer deploy + `upgrade` signed by **`GtAk…`** (NEW_JOE), or a later re-assignment of upgrade authority via an explicit `SetAuthority` (never set to `None` unless immutability is an intentional, separately approved decision).
- Squads treasury `9Wss…` remains relevant for treasury / collection flows; it is **no longer** the BPF upgrade authority for these two programs.
- No private keys are in this repository.

---

## 10. Contacts / repos

| Resource | URL |
|----------|-----|
| Canonical programs | https://github.com/jettoptx/jettoptx-poa-depin |
| Public docs site source | https://github.com/jettoptx/joe-docs (on-chain addresses) |
| Freeze tag | https://github.com/jettoptx/jettoptx-poa-depin/releases/tag/audit-assure-2026-07-27 |

---

*Prepared for Assure DeFi engagement readiness after Squads tx #63 execution. Co-Authored governance path: Founder + NEW_JOE approvals.*
