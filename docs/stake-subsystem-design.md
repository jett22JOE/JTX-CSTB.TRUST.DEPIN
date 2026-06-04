# Stake Subsystem Design — `jett-vault` v2.1

**Status**: design draft — pending review.
**Author**: Claude Opus 4.7 (working with Josh).
**Date**: 2026-05-01.
**Context**: replaces the broken honor-system `set_subscription` with a real on-chain stake-and-lock-up flow that helps the JTX peg by removing supply from circulation.

## Why this exists

The current `set_subscription(tier, jtx_amount)` instruction at [lib.rs:813](../programs/jett-vault/src/lib.rs) takes a caller-supplied `jtx_amount` and only checks `jtx_amount >= JTX_BASIC_THRESHOLD`. There is **no actual JTX transfer** and **no balance check** — anyone can claim any tier without holding JTX. This is shipping mainnet today.

The redesign (a) fixes that bug, and (b) goes one step further: instead of just *checking* a balance, users **transfer JTX to a vault PDA for the tier's duration**. Locked supply directly defends the $8 peg by reducing circulating tokens.

## Tier × duration table

| Tier byte | Display name | JTX required | Duration | Mint cap (OPTX/mo) | Source |
|---|---|---|---|---|---|
| 1 | MOJO | 12 JTX | 1 year (≈ 31,557,600 s) | 12 | `astroknots.space/stake` |
| 2 | DOJO | 444 JTX | 2 years (≈ 63,115,200 s) | 444 | `astroknots.space/stake` |
| 3 | SPACE COWBOY | 1,111 JTX | Lifetime (no expiry) | u32::MAX | `astroknots.space/stake` |

All values match the `STAKE_TIERS` array in `app/stake/page.tsx` and the new `shared-constants` crate.

## New on-chain state

### `StakePosition` PDA

```rust
#[account]
pub struct StakePosition {
    pub owner: Pubkey,           // 32 — the user's wallet
    pub tier: u8,                // 1 — 1=MOJO, 2=DOJO, 3=SPACE COWBOY
    pub amount: u64,             // 8 — locked JTX in 9-decimal raw
    pub staked_at: i64,          // 8 — clock.unix_timestamp at stake
    pub expires_at: i64,         // 8 — staked_at + duration; 0 = lifetime
    pub status: u8,              // 1 — 0=active, 1=expired, 2=withdrawn
    pub bump: u8,                // 1
}
// PDA seeds: [b"stake", owner.key().as_ref()]
// Total size: 8 (discriminator) + 32 + 1 + 8 + 8 + 8 + 1 + 1 = 67 bytes
```

**One position per wallet.** If a user wants to upgrade tier (MOJO → DOJO), they call `restake_upgrade` which transfers the delta and extends the duration. If they want to downgrade, they wait for expiry then re-stake at the lower tier.

### `StakeVault` token account (PDA-owned ATA)

A single program-owned associated token account for the JTX mint, owned by a `stake_vault_authority` PDA. All staked JTX accumulates here.

```rust
// PDA seeds: [b"stake_vault_authority", VAULT_CONFIG.as_ref()]
// ATA: associated_token_account(stake_vault_authority, JTX_MINT)
```

This separates stake-locked JTX from the general vault PDA so accounting stays clean.

## New instructions

### 1. `stake_for_tier(tier: u8)`

Replaces the current `set_subscription`. Steps:

1. Validate `tier ∈ {1, 2, 3}`.
2. Validate `vault_config.paused == false` and `agt_attestation.is_valid == true`.
3. Compute required amount: `JTX_MOJO_THRESHOLD` / `JTX_DOJO_THRESHOLD` / `JTX_SPACE_COWBOY_THRESHOLD`.
4. CPI `token::transfer` from `user_jtx_ata` → `stake_vault_ata` for the required amount.
5. Init `StakePosition` PDA: `owner=user, tier, amount=required, staked_at=now, expires_at=now+duration (0 if SPACE COWBOY), status=0, bump`.
6. Update `agt_attestation.subscription_tier = tier`, reset `mint_count_this_period = 0`, `period_start = now`.
7. Emit `StakeEvent { user, tier, amount, expires_at }`.

**Accounts:**
- `user: Signer<'info>`
- `user_jtx_ata: Account<'info, TokenAccount>` (mut, mint=JTX, owner=user)
- `stake_position: Account<'info, StakePosition>` (init, payer=user, seeds=["stake", user])
- `stake_vault_authority: AccountInfo<'info>` (PDA, seeds=["stake_vault_authority", vault_config])
- `stake_vault_ata: Account<'info, TokenAccount>` (mut, init_if_needed, mint=JTX, owner=stake_vault_authority)
- `agt_attestation: Account<'info, AgtAttestation>` (mut, has_one = owner)
- `vault_config: Account<'info, VaultConfig>`
- `jtx_mint: Account<'info, Mint>` (constraint: mint == shared::JTX_MINT_PUBKEY)
- `token_program: Program<'info, Token2022>`
- `associated_token_program: Program<'info, AssociatedToken>`
- `system_program: Program<'info, System>`

**Errors:**
- `InvalidSubscriptionTier` (tier not 1/2/3)
- `VaultPaused` / `AttestationRevoked`
- `InsufficientJtx` (user's ATA balance < required)
- `StakeAlreadyExists` (one position per wallet — must unstake or upgrade first)

### 2. `unstake()`

User reclaims their JTX after `expires_at` (or anytime for SPACE COWBOY — but that has no expiry, so see edge case below).

Steps:

1. Validate `stake_position.status == 0` (active) — not already withdrawn.
2. For non-lifetime: validate `clock.unix_timestamp >= expires_at`. **Reject early withdrawal.**
3. For lifetime (SPACE COWBOY, `expires_at == 0`): always rejected — lifetime stakes are **permanent** by design. (This makes SPACE COWBOY a real airdrop-eligibility commitment, not just a flex.)
4. CPI `token::transfer` from `stake_vault_ata` (signed by `stake_vault_authority` PDA) → `user_jtx_ata` for `stake_position.amount`.
5. Set `stake_position.status = 2` (withdrawn).
6. Reset `agt_attestation.subscription_tier = 0`, `mint_count_this_period = 0`.
7. Emit `UnstakeEvent { user, tier, amount, withdrew_at }`.

**Edge case — SPACE COWBOY lifetime stake**: documented as **truly permanent**. *Decision locked 2026-05-01*: there is **no** `unstake_lifetime` instruction. Once a user stakes 1,111 JTX for SPACE COWBOY, that JTX is locked in `stake_vault_ata` forever. This is a deliberate maximum-peg-defense + maximum-alignment-signal choice. Document this clearly in the staking UI before any user signs.

### 3. `restake_upgrade(new_tier: u8)`

Allows MOJO → DOJO or MOJO/DOJO → SPACE COWBOY upgrade in one tx. Transfers the delta (e.g., `JTX_DOJO_THRESHOLD - JTX_MOJO_THRESHOLD = 432 JTX`).

Steps:

1. Validate `new_tier > stake_position.tier` (upgrades only).
2. Validate `stake_position.status == 0` and (for non-lifetime) `expires_at > now` (upgrade an active position; expired positions must `unstake` then `stake_for_tier`).
3. Compute `delta = required_for(new_tier) - stake_position.amount`.
4. CPI `token::transfer` `delta` from user → stake_vault_ata.
5. Update `stake_position.tier = new_tier`, `amount = required_for(new_tier)`, `expires_at = now + duration_for(new_tier)` (0 if SPACE COWBOY).
6. Update `agt_attestation.subscription_tier = new_tier`, reset mint counter.
7. Emit `RestakeUpgradeEvent { user, old_tier, new_tier, delta_amount }`.

### 4. `migrate_v2_thresholds()` (one-time, multisig-gated)

Cleans up existing `AgtAttestation` records that may have a fake tier set under the old broken `set_subscription`. Multisig 2-of-3 only.

Steps:

1. Validate caller is in `vault_config.multisig_signers` and there are ≥ 2 approvals on `pending_action`.
2. Iterate a batch of `AgtAttestation` accounts passed in remaining_accounts.
3. For each: set `subscription_tier = 0`, `mint_count_this_period = 0`. **Don't touch StakePosition** (none exist yet — this is pre-stake-subsystem deploy).
4. Emit `MigrateV2Event { count, batch_index }`.

Off-chain helper script enumerates AgtAttestations and chunks them into batches of ~25 per tx (Solana account limit).

## Edge cases & policy decisions

### "What if the user transfers JTX out of their wallet AFTER staking?"

They can't. The stake transfer moves JTX from their ATA into the stake_vault_ata. After staking, the JTX is no longer in their wallet — they can't double-spend or transfer it. Tier is durable.

### "What if the JTX mint's transferFee gets re-enabled later?"

It can't. We just revoked `transferFeeConfigAuthority` to `None` in this session. Token-2022 program will reject any future SetAuthority on it. The stake transfer at the program level will always move the full amount.

### "What if the stake_vault_ata gets drained somehow?"

Only the `stake_vault_authority` PDA can sign withdrawals from it. The PDA is derived from `[b"stake_vault_authority", VAULT_CONFIG]` — only this program can sign for it. No external signer exists.

### "What about partial unstakes?"

Not supported in v1. A stake position is all-or-nothing. If a user wants to partial-unstake, they must wait for expiry and re-stake at a lower tier.

### "Tier downgrade flow?"

Not supported as a single instruction. Pattern: wait for expiry → call `unstake` → call `stake_for_tier(lower_tier)`. Adds friction by design — discourages tier-thrashing that would waste JTX peg defense.

### "What if Pyth/AARON/something fails during `mint_donor_nft`?"

Unrelated to the stake subsystem. `mint_donor_nft` is its own instruction with its own checks (Pyth read + audit freshness). The stake subsystem doesn't depend on either.

### "Can the multisig forcibly unstake a user's lifetime SPACE COWBOY stake?"

**No.** No instruction exists to release a lifetime stake — not even via multisig. This is the alignment commitment. If you want to add `unstake_lifetime` later, that requires a program upgrade and is a different governance conversation.

## Account size bumps

- `StakePosition` is new (67 bytes per).
- `AgtAttestation` adds no new fields (the existing `subscription_tier: u8` is reused).
- `VaultConfig` adds `stake_vault_authority_bump: u8` (1 byte). Easier than re-deriving on every call.

## Migration pathway

1. **Deploy v2.1 to devnet**: `anchor deploy --provider.cluster devnet`.
2. **Init stake_vault_authority + stake_vault_ata** (one-time devnet setup).
3. **Smoke-test all 4 new instructions** on devnet with test wallets.
4. **Run `migrate_v2_thresholds`** on devnet against test AgtAttestations.
5. **Pre-mainnet review**: diff new lib.rs vs current 2192-line; have a fresh set of eyes verify no regressions on the 14 unchanged instructions.
6. **Mainnet upgrade**: `anchor upgrade` on JTX5uXTi…
7. **Run `solana-verify`** to publish verified-build PDA on mainnet.
8. **Init stake_vault_authority + stake_vault_ata on mainnet**.
9. **Run `migrate_v2_thresholds` on mainnet** (likely 0 affected accounts since pre-launch).
10. **Update frontend `app/stake/page.tsx`**: replace whatever current Anchor IDL call it makes with the new `stake_for_tier(tier)` (no jtx_amount param) + a separate `unstake()` button on the user's stake position.

## Estimated effort

| Phase | Time |
|---|---|
| Rust impl: 4 new instructions + StakePosition account + accounts structs | 2 days |
| Rust impl: migration instruction + helpers | 0.5 day |
| Devnet smoke-test (write tests/stake-subsystem.ts) | 1 day |
| Pre-mainnet diff review | 0.5 day |
| Mainnet upgrade + verifiable build | 0.5 day |
| Frontend update on `app/stake/page.tsx` | 1 day |
| **Total** | **~5.5 days** |

This is in addition to the Pyth integration in `mint_donor_nft` and the audit-freshness check (separate, ~1 day each). Full v2.1 upgrade lands at ~7-8 days.

## Decisions locked (2026-05-01)

1. **SPACE COWBOY is truly permanent.** No `unstake_lifetime` instruction. The 1,111 JTX is locked in `stake_vault_ata` forever. UI must clearly disclose this before signing.
2. **One stake position per wallet.** PDA seeds `[b"stake", owner]`. To upgrade tier, user calls `restake_upgrade(new_tier)` which transfers the JTX delta. Multi-position gifting is out of scope; cofounders get TipLinks instead.
3. **Helius webhooks for indexing.** Extend AARON Router's existing `/donations/webhooks/helius` handler with a parallel `/stakes/webhooks/helius` route. Filter by `stake_for_tier` / `unstake` / `restake_upgrade` instruction discriminators. Webhook writes to SpacetimeDB `jtx_onchain_action` table for queryability. Frontend reads stake state from SpacetimeDB OR direct on-chain (`getProgramAccounts` filtered by `StakePosition` discriminator + owner) — both supported, frontend picks whichever is faster per call.

### AARON Router webhook contract (informal)

When Helius fires the webhook for a stake instruction, AARON does:

```
1. parse instruction discriminator + accounts
2. extract: owner, tier, amount, expires_at (from StakePosition account post-tx state)
3. INSERT into spacetimedb.jtx_onchain_action(
     id auto, created_at=now, requested_by=owner, action_type='stake'|'unstake'|'restake_upgrade',
     token='JTX', amount_lamports=amount, from_wallet=owner, to_wallet=stake_vault_authority,
     status='confirmed', tx_signature=<sig>, completed_at=now
   )
4. (optional) WS push to frontend session for instant UI update
```

This means the frontend can query SpacetimeDB for `jtx_onchain_action where requested_by=<wallet> and action_type like 'stake%'` to get a wallet's stake history without ever touching Solana RPC. Lightning fast and free at our scale.
