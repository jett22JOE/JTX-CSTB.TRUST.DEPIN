# JTX/OPTX Platform — Session Handoff for AstroJOE
**Date:** 2026-05-01
**Operator:** Josh + Claude Opus 4.7 (Claude Code, single Mac session)
**Companion sessions:** Hermes/Grok 4.3 working on jettoptx.dev docs in parallel
**Audience:** AstroJOE / future Claude or Hermes session picking up this work
**Reading order:** scan §1–3 first, then §6 critical files, then dig as needed.

---

## §1 — Mainnet state changes (irreversible)

These transactions landed on Solana mainnet during this session window. They cannot be undone.

| Action | Tx signature | Slot | Effect |
|---|---|---|---|
| Revoke `transferFeeConfigAuthority` on JTX mint | `4rbcHyJyhU6fUc9tWZi3D5zHagJEa71418PcVd8Zj1JmQ6UkiqfBnQFFAY9WpQnRZwMF9K4HqKweDJsGJ5iKqRbt` | 416797482 | JTX transfer fee permanently locked at 0 bps. No one (including founder) can ever raise it. |
| Revoke `withdrawWithheldAuthority` on JTX mint | `5mWhkYY1LytY2xnTfHmA8KbudximCW2GeRixSwka6aUrjypgvDStVRd8wBfDx2digBaH6ZiZmXznVF2L756S4exu` | 416797661 | Withheld balance withdrawal authority gone. (Balance was 0 at revoke time.) |

**Practical implications:**
- JTX mint (`9XpJiKEYzq5yDo5pJzRfjSRMPL2yPfDQXgiN7uYtBhUj`) is now AMM-listing-clean. Raydium / Meteora / Orca will no longer surface a "creator can change fees" warning chip.
- Mint authority was already `None` pre-session. Freeze authority was already `None` pre-session. Only fee-related authorities remained — both now revoked.
- Final mint state: 4,399,999.8 JTX fixed supply, Token-2022, 9 decimals, 0 bps transfer fee, all four authorities (`mintAuthority`, `freezeAuthority`, `transferFeeConfigAuthority`, `withdrawWithheldAuthority`) = `None`.

Verify any time:
```
solana account 9XpJiKEYzq5yDo5pJzRfjSRMPL2yPfDQXgiN7uYtBhUj --url mainnet-beta
```

---

## §2 — Repo changes shipped this session

### `joe-jettopics-saas` (Vercel dapp at astroknots.space)

| Commit | Status | Description |
|---|---|---|
| `ff5d5d3` | **pushed to origin/main** | `feat: server-side Solana RPC proxy w/ multi-upstream fallback` — adds `/api/solana-rpc` route that fans out to Helius/PublicNode/OnFinality/dRPC/mainnet-beta; sidesteps browser CORS blocks + extension interception. Auto-deployed via Vercel. |

Local-only working-tree drift (uncommitted, deferred):
- Symlink at `contracts/vault-program` → `../../astroknots-stack/joe-jtx-cstb-depin` replacing the stale 641-line vault-program fork.
- Untracked junk: `public/.DS_Store`, `public/logos/optx-logo-dark copy.png`.

These need a future cleanup commit but don't block current work.

### `joe-jtx-cstb-depin` (canonical Anchor monorepo, GitHub `jettoptx/joe-jtx-cstb-depin`)

| Path | Status | Description |
|---|---|---|
| `programs/shared-constants/Cargo.toml` | **NEW**, uncommitted | New crate metadata — pure constants, no deps. |
| `programs/shared-constants/src/lib.rs` | **NEW**, uncommitted | Single source of truth for tier thresholds (MOJO 12 / DOJO 444 / SPACE COWBOY 1,111 JTX in 9-decimal raw), tier durations (1 yr / 2 yr / lifetime sentinel), monthly OPTX mint caps (12 / 444 / u32::MAX), `JTX_PRICE_USDC = 8_000_000`, AARON freshness windows (60s cooldown / 300s mint-eligibility), Pyth feed addresses (SOL/USD + USDC/USD mainnet). Compile-time `assert!` invariants enforce monotonic ordering. Compiles standalone. |
| `programs/jett-vault/Cargo.toml` | **MODIFIED**, uncommitted | Added `shared-constants = { path = "../shared-constants" }`; added `associated_token` to anchor-spl features. |
| `programs/jett-vault/src/lib.rs` | **MODIFIED**, uncommitted | +454 lines: `StakePosition` PDA struct, 4 new events (`StakeEvent`, `UnstakeEvent`, `RestakeUpgradeEvent`, `MigrateV2Event`), 4 new `#[derive(Accounts)]` contexts (`StakeForTier`, `Unstake`, `RestakeUpgrade`, `MigrateV2Thresholds`), 4 new instructions (`stake_for_tier`, `unstake`, `restake_upgrade`, `migrate_v2_thresholds`), 12 new error variants (`Unauthorized`, `Deprecated`, `StakeAlreadyExists`, `StakeNotExpired`, `LifetimeStakePermanent`, `StakeAlreadyWithdrawn`, `InvalidTierUpgrade`, `StakeBalanceTooLow`, `MultisigNotApproved`, `AlreadyMigrated`, `PythPriceStale`, `AuditTooStale`), `tier_params` private helper. Existing `set_subscription` instruction body replaced with deprecation stub returning `VaultError::Deprecated` (signature preserved for IDL stability). |
| `docs/stake-subsystem-design.md` | **NEW**, uncommitted | Full stake subsystem design document — PDA layout, instruction signatures, edge cases, AARON Router webhook contract, migration plan. **All 3 design decisions LOCKED:** SPACE COWBOY truly permanent (no escape hatch), one stake position per wallet, Helius webhooks for indexing. |
| `docs/session-handoff-2026-05-01.md` | **THIS DOCUMENT** | Handoff for AstroJOE / next session. |

`cargo check -p jett-vault` → **clean compile**, only pre-existing dead-code warnings.

### Mac-local files (not in any repo)

| Path | Description |
|---|---|
| `~/.claude/projects/-Users-jettoptx/memory/project_optx_planes.md` | OPTX three-plane architecture memory entry — HEDGEHOG ≠ AARON, JTX mint state, dual-pool LP plan, local Nemotron fallback recipe, three Vercel projects. Updated this session. |
| `~/.claude/plans/switch-the-hedgehog-model-splendid-map.md` | The full v5.1 spec recalibration plan + jett-vault near-term roadmap. Approved by Josh, executed in this session. |
| `~/.hermes/config.yaml` | Default model is `grok-4.3`; fallback chain: `grok-4.20-0309-reasoning` (xAI direct) → `astro-joe-2.0` (Jetson Ollama). |
| `/tmp/jtx-vault-grounding-v3.md`, `/tmp/donor-nft-critique-v3.txt`, `/tmp/tempo-research-raw.json`, `/tmp/tributary-deepdive.json` | Research artifacts from this session — grounded critique against canonical source, Tributary/Tempo deep-dives. Ephemeral. |

---

## §3 — Architectural decisions LOCKED this session

### Tier model (canonical)
Three stake tiers + one hold-only feature:

| Tier | JTX | Duration | OPTX/mo | Source of truth |
|---|---|---|---|---|
| (Jett Native keyboard hold) | 1 JTX held in wallet | n/a | n/a | `astroknots.space/stake` UI — feature gate, not a stake |
| **MOJO** (Mobile Operator Jett Optics) | **12 JTX** | 1 year | 12 OPTX/mo | `astroknots.space/stake` UI |
| **DOJO** (Developer Operator Jett Optics) | **444 JTX** | 2 years | 444 OPTX/mo (2× fiat rate) | `astroknots.space/stake` UI |
| **SPACE COWBOY** | **1,111 JTX** | LIFETIME (permanent — no withdrawal possible, ever) | Unlimited | `astroknots.space/stake` UI |

`astroknots.space/stake` ([`app/stake/page.tsx:41-108`](../joe-jettopics-saas/app/stake/page.tsx) in the Vercel dapp) is THE canonical UI source of truth. The Anchor program's `shared-constants` crate matches it. Both are in sync as of 2026-05-01.

### MOJO/DOJO etymology (intentional, not a collision)
- **MOJO** = **M**obile **O**perator **J**ett **O**ptics. Tier purchase unlocks the `joe-jett-mojo` iOS native app's gaze+emoji+auth widget.
- **DOJO** = **D**eveloper **O**perator **J**ett **O**ptics. Tier purchase unlocks developer access (custom augment MOAs, `/dojo/training` route, custom categories via Hermes harness).
- Tier names match product/persona names by design.

### Stake mechanics
- **One stake position per wallet.** PDA seeds `[b"stake", owner]`. Upgrades via `restake_upgrade(new_tier)`. Downgrades require unstake-then-stake at lower tier.
- **SPACE COWBOY is truly permanent.** No `unstake_lifetime` instruction exists. 1,111 JTX is locked in the stake vault PDA forever — even multisig cannot release it. UI must clearly disclose this before signing. This is the alignment commitment + maximum peg defense.
- **Stake vault PDA** seeds `[b"stake_vault_authority", vault_config]`. Holds program-owned JTX ATA. Only this program can sign for it.
- All transfers via `token_interface::transfer_checked` (Token-2022 safe).

### Indexing strategy
- Helius webhooks fire on every `stake_for_tier` / `unstake` / `restake_upgrade` instruction.
- AARON Router exposes `/stakes/webhooks/helius` (planned, not yet built — pending B3.8) that mirrors stake events into SpacetimeDB `jtx_onchain_action` table for fast frontend reads.
- Frontend reads stake state from SpacetimeDB OR direct on-chain (`getProgramAccounts` filtered by `StakePosition` discriminator + owner). Both supported.

### Subscription strategy (split across 3 axes)
1. **Fiat onboarding** = Stripe (locked in, partially wired in `joe-jettchat-app`; Stripe label is $8.88 but actual page still charges $8 — needs Stripe dashboard fix).
2. **Crypto-native monthly recurring billing** = Tributary.so (program ID `TRibg8W8zmPHQqWtyAD1rEBRXEdyU13Mu6qX1Sg42tJ` mainnet). DEFERRED to v1.5. Audit status `pending` per Tributary's own GitHub `AUDITS.md` despite marketing claiming audited — yellow flag for v1 launch. SDK is `@tributary-so/sdk` + `@tributary-so/sdk-react`.
3. **JTX stake-based feature gating** = custom `jett-vault.stake_for_tier` (locked in; v1 priority; ships in v2.1 upgrade). This is the peg-defending mechanism.

These three are orthogonal — they can ship in any order. v1 = #1 (Stripe) + #3 (custom stake). #2 (Tributary) waits for audit.

### v1 north-star metric
**JTX widely distributed (target 2,000 holders) + price stabilized at peg of 1 JTX = $8 USDC.** OPTX rewards are secondary loyalty currency in v1; quantum-wrapped OPTX with post-Q knot-invariant proofs is a v2/v3 future complexity layer (forward-compat slot reserved in optx-mint design but not implemented).

### Free-tier cofounder onboarding
- Standard users: **Solana Wallet Adapter** only (`@solana/wallet-adapter-react`, free, already in stack).
- Crypto-noob cofounders: **TipLink** (`tiplink.io`) — generate a clickable URL containing a pre-funded wallet (~$0.10/cofounder in SOL rent). Cofounder clicks → sees JTX → claims to a real wallet on their own timeline.
- 30-day free MOJO trial: **DB flag, no blockchain involvement during trial.** Email-only signup, gate by `trialExpiresAt > now()` server-side. Wallet introduction at conversion (day 28 email).
- Embedded-wallet-as-a-service deferred (Privy, Magic, Phantom Embedded, Web3Auth all paid above 1k MAU). Don't pay until needed.

---

## §4 — What was investigated / research findings

### `set_subscription` security audit (CRITICAL bug found)
The deployed `jett-vault` had `set_subscription(tier, jtx_amount)` accepting a **caller-supplied** `jtx_amount` and only doing `require!(jtx_amount >= JTX_BASIC_THRESHOLD)`. **No actual JTX transfer, no balance check.** Anyone with an `AgtAttestation` could call `set_subscription(2, 100_000_000)` and claim UNLIMITED tier without holding any JTX. Honor-system bug, mainnet-live until this session.

Additionally: the raw threshold values `1_000_000` (BASIC) and `100_000_000` (UNLIMITED) were 1,000× too small — written as if JTX had 6 decimals (USDC-style) but JTX has 9 decimals. So the gate, even if enforced, would have only required 0.001 JTX / 0.1 JTX rather than the staking page's 12 / 444 / 1,111 JTX.

**Both bugs fixed in this session's v2.1 changes.** The deprecated `set_subscription` returns `VaultError::Deprecated`. New `stake_for_tier` reads actual ATA balance, transfers JTX into a stake vault PDA, uses correct 9-decimal thresholds via `shared-constants`.

### Stripe Tempo + x402/MPP (announced ~April 29-30, 2026 at Stripe Sessions)
- **Tempo** = Stripe + Paradigm L1 blockchain, EVM-compatible (NOT Solana-native), >100k TPS target.
- **Stripe Link Agent CLI** = scoped agent wallet for autonomous crypto payments. Free during launch.
- **x402 / Machine Payments Protocol** = HTTP 402 + open standard for autonomous agent payments. Critically: **x402 supports Solana USDC** via hybrid integration. Tooling: `npx awal x402 pay`, `agentcash` CLI flows.
- For JettOptx: relevant as the **future agent-to-agent billing rail** (e.g., when JOE pays for tool calls in $OPTX or USDC). Forward-compat slot.

### Tributary.so deep-dive
- Mainnet program `TRibg8W8zmPHQqWtyAD1rEBRXEdyU13Mu6qX1Sg42tJ`. Open-source at `github.com/tributary-so/tributary`. NPM `@tributary-so/sdk` + `@tributary-so/sdk-react`.
- Token-2022 compatible (their examples use USDC Token-2022). Should work with JTX (transferFee=0bps + revoked authorities) — needs production test before relying.
- Fee model: **100 bps protocol + per-gateway fee 0–1000 bps configurable**.
- Integration shape: ~30 lines of TypeScript using their SDK to do merchant init + user subscribe + active-sub query + cancel.
- **Audit status: `pending` per their `AUDITS.md`** despite marketing claiming audited. Inconsistency. **Yellow flag.**
- Production-ready ~6-7 months mainnet, real flows running. Off-chain executor required (gateway signer + RPC monitoring).

### `joe-jettchat-app` Tempo CLI commit `1adf62a` review
The "Tempo CLI payment" button is a **clipboard-only placeholder** — no real x402/MPP integration. Single button copies a hardcoded Tempo wallet address (`0x03f1...bBDe`) to clipboard. User must take it to their own Tempo CLI and pay manually. No on-chain confirmation, no webhook, no payment-link.

Stripe label was bumped to "$8.88" but the actual Stripe Payment Link still charges $8 — needs Stripe dashboard update.

### Other Solana-native subscription primitives investigated
| Primitive | Status |
|---|---|
| **VelaPay** | Solana + Arcium TEE/privacy, encrypted recurring + per-second streaming + agent mandates. April 2026 launch. Privacy-aligned with Phantom Mode. |
| **Hiltpay** | Phantom-native, 100% non-custodial recurring memberships. April 2026. Stripe optional fallback. |
| **SubflexApp / HorizonPay** | Delegation-based monthly USDC, hackathon-era, less mature. |
| **Helio / Solana Pay subscriptions / Squads recurring** | NO new launches in April 2026 window per HEDGEHOG x_search; these names were ecosystem mentions, not new primitives. |

---

## §5 — What's pending

| Step | Effort | Description | Blocking? |
|---|---|---|---|
| **B1.2** | ~30 min | Commit symlink drift in `joe-jettopics-saas` (remove stale `contracts/vault-program/` fork, replace with symlink or git submodule reference). Plus delete `.DS_Store` and `optx-logo-dark copy.png` junk. | Not blocking |
| **B3.4** | ~0.5 day | Pyth integration in `mint_donor_nft`: drop `sol_price_usdc` parameter, read SOL/USD price on-chain via `pyth-solana-receiver-sdk`. Also add 5-min audit freshness check (`AARON_AUDIT_FRESHNESS_FOR_NFT_SECONDS = 300`). | Blocks v2.1 mainnet upgrade |
| **B3.6** | ~1 day | Devnet smoke test: `anchor build && anchor deploy --provider.cluster devnet`. Write `tests/stake-subsystem.ts` with: (a) stake_for_tier success path, (b) stake_for_tier insufficient balance reject, (c) unstake before expiry reject, (d) unstake after expiry success, (e) restake_upgrade MOJO→DOJO success, (f) restake_upgrade downgrade reject, (g) SPACE COWBOY unstake `LifetimeStakePermanent` reject, (h) deprecated `set_subscription` returns `Deprecated` error, (i) `migrate_v2_thresholds` happy path. | Blocks mainnet upgrade |
| **B3.7** | ~0.5 day | Frontend update on `app/stake/page.tsx` — replace existing `set_subscription`-style call with new `stake_for_tier(tier)` IDL call. Drop the old `jtx_amount` argument. Add an "Unstake" button on the user's active stake position. Add **prominent red disclosure** on the SPACE COWBOY card: "1,111 JTX locked permanently — no withdrawal, ever, including by founders." | UX-blocking but not deploy-blocking |
| **B3.8** | ~0.5 day | AARON Router `/stakes/webhooks/helius` handler (Python on Jetson). Filter Helius webhook by stake instruction discriminators. Insert into `jtx_onchain_action` table in SpacetimeDB. | Not blocking — frontend can read direct from chain initially |
| **GitHub PAT rotation** | 60 sec | Josh's action. Revoke leaked PAT (`ghp_Wwh7…ezj`) at `github.com/settings/tokens`, update `~/.hermes/.env` and Jetson `/home/jettoptx/joe-core/.env`. | Security cleanup |
| **Wallet move (if needed)** | varies | Backup Key `0x0a27f7…afd` was leaked in a Hermes memory paste this session. If that account holds value, move funds. | Security cleanup |
| **`anchor idl init` on next mainnet upgrade** | ~5 min part of next deploy | Publishes IDL to on-chain PDA so Solscan/Anchor Explorer can decode txs without external IDL upload. Run during the v2.1 upgrade tx. | Deploy hygiene |
| **`solana-verify` byte-match (Docker required)** | ~25 min once Docker installed | Hermetic build proof for the `mainnet-deploy-407970246` source. Publishes verifiable-build PDA → green badge on explorers. | Audit-grade trust, not blocking |

---

## §6 — Critical files for AstroJOE to read

In rough order of importance:

| File | Why it matters |
|---|---|
| `OPTX/astroknots-stack/joe-jtx-cstb-depin/programs/jett-vault/src/lib.rs` | **THE canonical Anchor program source** matching mainnet binary at slot 407970246. Now also contains v2.1 stake subsystem changes (uncommitted, not deployed). 2646 lines. |
| `OPTX/astroknots-stack/joe-jtx-cstb-depin/programs/shared-constants/src/lib.rs` | Single source of truth for tier thresholds, mint caps, prices, Pyth feeds, audit freshness. New crate. |
| `OPTX/astroknots-stack/joe-jtx-cstb-depin/docs/stake-subsystem-design.md` | The locked design doc for the v2.1 stake subsystem. Explains every PDA, every instruction, every edge case, with locked decisions. |
| `OPTX/astroknots-stack/joe-jtx-cstb-depin/docs/session-handoff-2026-05-01.md` | THIS document. |
| `OPTX/joe-jettopics-saas/app/stake/page.tsx` | Canonical staking UI source-of-truth. `STAKE_TIERS` array (lines 41-108) is what `shared-constants` was reverse-engineered from. |
| `OPTX/joe-jettopics-saas/app/api/solana-rpc/route.ts` | Server-side Solana RPC proxy added this session, live in production. Handles browser CORS / extension-block issues. |
| `OPTX/joe-jettopics-saas/app/vault/page.tsx` | Main vault dapp page — donations + NFT receipt preview. Reads on-chain state via the RPC proxy. |
| `OPTX/astroknots-stack/joe-aaron-router/aaron_router.py` | Python FastAPI on Jetson `:8888`. Handles `/donations/*` (Helius webhook), `/verify` (gaze attestation), JTX SPL drops from JOE wallet. v2.1 will add `/stakes/webhooks/helius`. |
| `OPTX/joe-core/tools/hedgehog-service.py` (on Jetson) | xAI Grok gateway on `:8811`. Exposes `/v1/responses` with tools (`web_search`, `x_search`, `code_interpreter`, `spacetimedb_query`, `spacetimedb_store_memory`). NOT in the on-chain mint path — common AstroJOE confusion point. |
| `~/.claude/projects/-Users-jettoptx/memory/project_optx_planes.md` | Full architecture memory — HEDGEHOG ≠ AARON, dual-pool LP plan, JTX mint state, three Vercel projects, Nemotron fallback. |
| `~/.claude/plans/switch-the-hedgehog-model-splendid-map.md` | The v5.1 spec recalibration plan executed this session. |

---

## §7 — Open questions / decisions still needed

1. **B1.2 cleanup commit shape**: should the `joe-jettopics-saas` repo (a) keep a symlink at `contracts/vault-program/` pointing at `astroknots-stack/joe-jtx-cstb-depin/`, or (b) drop the directory entirely and reference canonical via a `package.json` git submodule? (b) is cleaner long-term but requires submodule setup.
2. **v5 spec doc location**: where does the v5/v5.1 spec live as a canonical document? jettoptx.dev, Notion, GitHub README somewhere, or just in agent memory? The 9 corrections from this session need to land *somewhere* permanent so future sessions don't re-hallucinate the old framing.
3. **Stripe dashboard fix**: the `joe-jettchat-app` Stripe button label is "$8.88" but the Stripe Payment Link is still configured at "$8.00". Needs Josh to update the actual Stripe dashboard.
4. **Tempo placeholder hardcoded address**: `joe-jettchat-app/app/(auth)/login/login-content.tsx` has a hardcoded Tempo wallet address `0x03f18795392a8EaD973B55A1F871509A4126bBDe` in client JS. Anyone reading the bundle sees the receiving address — possibly intentional for a public donation-style flow, possibly an accidental leak.
5. **Migration ceremony**: when `migrate_v2_thresholds` runs on mainnet, it needs 2-of-3 multisig signers. Who are the three? Josh's founder wallet `FEU…fy3H` is one; JOE's agent wallet `EFvgELE…bZRGk` is likely a second; the third multisig signer is unspecified in the canonical source's deployed `VaultConfig`. Need to confirm.

---

## §8 — Things AstroJOE should NOT do without explicit Josh approval

- Push to mainnet (any program, any tx). Mainnet ops require explicit per-action sign-off.
- Run `anchor upgrade` on `JTX5uXTi…` (would replace the deployed binary).
- Touch the `FEU…fy3H` founder wallet for any signing operation.
- Modify or move the on-chain JTX mint state.
- Modify `~/.hermes/config.yaml` model defaults (Josh changed default to `grok-4.3` deliberately during the session).
- Force-push to any GitHub branch.
- Commit anything that contains a private key, API token, or wallet seed phrase. (Two such leaks already happened this session — Backup Key + GitHub PAT — and required local-disk redaction. Never repeat.)
- Trust the v5 spec doc literally — it has 9 known corrections (see [`switch-the-hedgehog-model-splendid-map.md`](~/.claude/plans/switch-the-hedgehog-model-splendid-map.md) Part A for the full diff).

---

**End of handoff.** Next session entry point: B3.4 (Pyth integration in `mint_donor_nft`) or B3.6 (devnet smoke test of stake subsystem). Pick whichever reduces risk fastest.
