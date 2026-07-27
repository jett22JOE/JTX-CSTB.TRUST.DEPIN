# Local agent prompt — transfer BPF upgrade authority to NEW_JOE

Use this prompt with a **local Cursor agent on the Mac** (or any OPTX MESH device that can reach the signing wallet / Squads). Paste the block under [Prompt](#prompt) as the agent task.

Related:

- Freeze tag: [`audit-assure-2026-07-27`](https://github.com/jettoptx/jettoptx-poa-depin/releases/tag/audit-assure-2026-07-27) (`71eb004d1cd6cd474c62c575db68b9496b9da86b`)
- Audit brief: [`docs/AUDIT.md`](./AUDIT.md)
- Squads runbook (saas): `jettoptx-saas/SQUADS-RUNBOOK.md`

---

## Prompt

````text
TASK: Transfer Solana BPF upgrade authority for Jett Optics mainnet programs to the new JOE wallet. Run this from the Mac (or any OPTX MESH device that can reach the signing wallet / Squads). Do NOT paste private keys into chat. Do NOT revoke/make immutable. Do NOT redeploy or upgrade bytecode.

═══════════════════════════════════════
TARGET (new upgrade authority)
═══════════════════════════════════════
Pubkey:  GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq
SNS:     astro.knots.sol
Label:   NEW_JOE (ops) — live agent / ops wallet on OPTX MESH

═══════════════════════════════════════
PROGRAMS (mainnet-beta ONLY)
═══════════════════════════════════════
1) PoA Trust
   Program:   85sqs4upQiPrvk1NMuyfHVQoW1EGdgk8m2cQb7uMxXTF
   Crate:     jtx_optx_devnet_poa_trustjoe
   Repo:      https://github.com/jettoptx/jettoptx-poa-depin
   Freeze:    tag audit-assure-2026-07-27 @ 71eb004d1cd6cd474c62c575db68b9496b9da86b

2) Jett Vault
   Program:   JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7
   Module:    jett_vault

═══════════════════════════════════════
CURRENT AUTHORITY (must approve / sign)
═══════════════════════════════════════
Both programs today:
  9WssADzftzptNnMHLzPZYAFApUfE7qLYChicH1Wh6YD7
  = treasury / Squads 2-of-3 vault

PoA prior transfer record (EFvg → 9Wss, 2026-07-26):
  tx 4PDYvJX1q1sFzc9SggFj6AR9UXsPyUkBxDwmZoJWi93udcWDE3viD9HGqUECQ97KSS9x58T636tuKTGVBrQWoks1

CRITICAL: You cannot transfer with GtAkS5tY… itself. The CURRENT authority (9Wss… / Squads) must sign.

═══════════════════════════════════════
DO THIS (in order)
═══════════════════════════════════════

STEP 0 — Discover signing path on this MESH device
- Check whether Squads is available (app.squads.so / v4.squads.so) with founder/JOE signer wallets that control 9Wss….
- Check local Solana CLI config: `solana config get`
- Identify which MESH device holds the Squads cosigners (Mac, Seeker, JOE edge). Prefer Squads UI if 9Wss is a Squads vault PDA; only use raw `solana program set-upgrade-authority` if you truly have a keypair that IS 9Wss… (unlikely if it’s Squads).

STEP 1 — Snapshot BEFORE (read-only)
```bash
solana program show 85sqs4upQiPrvk1NMuyfHVQoW1EGdgk8m2cQb7uMxXTF --url mainnet-beta
solana program show JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7 --url mainnet-beta
```
Expect Authority = 9WssADzftzptNnMHLzPZYAFApUfE7qLYChicH1Wh6YD7 for both.
Save the full output.

STEP 2 — Transfer (one program at a time)

Path A — Squads (PREFERRED if 9Wss is Squads-controlled)
1. Open Squads multisig that owns vault/authority 9Wss….
2. Create / approve proposal: set upgrade authority for program 85sqs… → GtAkS5tY….
3. Collect 2-of-3 approvals; execute.
4. Repeat for program JTX5u….
5. Record proposal IDs + execute tx signatures.

Path B — CLI (ONLY if current authority keypair is literally available as a file on this device)
```bash
solana program set-upgrade-authority 85sqs4upQiPrvk1NMuyfHVQoW1EGdgk8m2cQb7uMxXTF \
  --new-upgrade-authority GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq \
  --url mainnet-beta \
  --keypair <PATH_TO_CURRENT_9Wss_OR_AUTHORIZED_SIGNER>

solana program set-upgrade-authority JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7 \
  --new-upgrade-authority GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq \
  --url mainnet-beta \
  --keypair <PATH_TO_CURRENT_9Wss_OR_AUTHORIZED_SIGNER>
```

If Squads members are on different OPTX MESH devices: propose on Mac, approve on Seeker/JOE device, execute once threshold met. Do not unlock keys over untrusted remotes.

STEP 3 — Verify AFTER
```bash
solana program show 85sqs4upQiPrvk1NMuyfHVQoW1EGdgk8m2cQb7uMxXTF --url mainnet-beta
solana program show JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7 --url mainnet-beta
```
Success = Authority is GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq for BOTH.

Optional SNS check:
```bash
# confirm astro.knots.sol still resolves to GtAkS5tY… (via SNS tooling / explorer)
```

STEP 4 — Report back (paste into chat / Telegram)
For each program:
- before authority
- after authority
- transfer/execute tx signature(s)
- method used (Squads proposal IDs vs CLI)
- which MESH device(s) signed/approved

STEP 5 — Doc follow-up (if transfer succeeds)
Open a small PR on jettoptx-poa-depin + jettoptx-docs updating:
- README / docs/AUDIT.md / on-chain-addresses upgrade-authority tables
- set live authority to GtAkS5tY… (astro.knots.sol)
- note previous was 9Wss… treasury/Squads
Do NOT invent that Squads still holds upgrade authority after the transfer.

═══════════════════════════════════════
HARD CONSTRAINTS
═══════════════════════════════════════
- Mainnet-beta only for these two program IDs (devnet is optional / out of scope unless asked).
- Never `--skip-new-upgrade-authority-signer-check` unless you know why.
- Never make the program immutable.
- Never deploy/upgrade program bytecode in this task.
- Never print, upload, or commit private keys / seed phrases.
- If you cannot get 2-of-3 Squads approvals from MESH devices, STOP and report blockers (which signers missing) instead of forcing Path B.

BEGIN with STEP 0 + STEP 1 snapshots, then proceed.
````

---

## Quick reference

| Field | Value |
|-------|--------|
| **Target** | `GtAkS5tYaqi6XQrinuFyqKQkK29SFQsUY9gQ2XpLXLwq` (`astro.knots.sol`) |
| **Current** | `9WssADzftzptNnMHLzPZYAFApUfE7qLYChicH1Wh6YD7` |
| **PoA Trust** | `85sqs4upQiPrvk1NMuyfHVQoW1EGdgk8m2cQb7uMxXTF` |
| **Jett Vault** | `JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7` |
