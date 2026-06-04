//! Shared constants for the JTX/OPTX on-chain programs.
//!
//! Single source of truth for tier thresholds, mint caps, $JTX peg price, and
//! Pyth oracle feed addresses. Imported by `jett-vault`, the upcoming
//! `jtx-buy-vault`, and `jtx-cstb-trust` so threshold/price values cannot
//! desync across program upgrades.
//!
//! The frontend `astroknots.space/stake` is the canonical product source of
//! truth for tier display + JTX amounts; values here MUST match what's shown
//! on that page (see `app/stake/page.tsx` STAKE_TIERS array).

// ─── JTX token mint ────────────────────────────────────────────────────────────
//
// Token-2022 mint, 9 decimals, fixed supply 4,399,999.8 JTX, mint+freeze
// authorities revoked, transferFee 0bps, fee+withhold authorities revoked
// (mainnet, as of 2026-04-30 — see slots 416797482 / 416797661 for the revoke
// transactions).

/// Lowest-unit raw count for 1 JTX (10^9 because JTX uses 9 decimals).
pub const JTX_DECIMALS_RAW: u64 = 1_000_000_000;

// ─── JTX-stake gate thresholds ─────────────────────────────────────────────────
//
// Match the STAKE_TIERS array in app/stake/page.tsx. These represent how many
// JTX a user must hold/stake to unlock each tier's features.

/// MOJO tier — 12 JTX (1-year duration on staking page).
pub const JTX_MOJO_THRESHOLD: u64 = 12 * JTX_DECIMALS_RAW;

/// DOJO tier — 444 JTX (2-year duration on staking page; 2× OPTX/SOL fiat rate).
pub const JTX_DOJO_THRESHOLD: u64 = 444 * JTX_DECIMALS_RAW;

/// SPACE COWBOY tier — 1,111 JTX (lifetime duration; legendary).
pub const JTX_SPACE_COWBOY_THRESHOLD: u64 = 1_111 * JTX_DECIMALS_RAW;

// ─── Tier durations ────────────────────────────────────────────────────────────
//
// Seconds-since-stake until a stake position expires. SPACE COWBOY lifetime
// stakes set `expires_at = 0` to indicate "never expires"; do NOT use these
// constants for SPACE COWBOY stakes.

/// MOJO duration: 1 year (365.25 days).
pub const MOJO_DURATION_SECONDS: i64 = 31_557_600;

/// DOJO duration: 2 years (2 × 365.25 days).
pub const DOJO_DURATION_SECONDS: i64 = 63_115_200;

/// Sentinel for "never expires" (SPACE COWBOY lifetime).
pub const LIFETIME_NEVER_EXPIRES: i64 = 0;

// ─── Monthly OPTX mint caps per tier ───────────────────────────────────────────
//
// How many OPTX rewards each tier can claim per 30-day period (resets on tier
// change or period rollover). Mirrors the `optxRate` field on STAKE_TIERS.

/// MOJO: 12 OPTX/mo.
pub const MOJO_MINT_CAP: u32 = 12;

/// DOJO: 444 OPTX/mo (2× fiat-equivalent rate).
pub const DOJO_MINT_CAP: u32 = 444;

/// SPACE COWBOY: unlimited.
pub const SPACE_COWBOY_MINT_CAP: u32 = u32::MAX;

// ─── $JTX peg pricing ──────────────────────────────────────────────────────────
//
// Fixed-price reference for `mint_donor_nft` receipts and (later) the
// `jtx-buy-vault` USDC-to-JTX swap. Values are in 6-decimal USDC units
// (matching mainnet USDC mint EPjFW...rD27t).

/// $8.00 USDC = 1 JTX peg.
pub const JTX_PRICE_USDC: u64 = 8_000_000;

// ─── AARON gaze-attestation freshness ──────────────────────────────────────────

/// Minimum seconds between two `aaron_audit` calls for the same attestation
/// (anti-spam on the audit instruction itself; current jett-vault default).
pub const AARON_AUDIT_COOLDOWN_SECONDS: i64 = 60;

/// Maximum age (seconds) of an `AaronAuditAccount` accepted by `mint_donor_nft`.
/// Tighter than the cooldown because NFT mints are higher-stakes than gaze
/// attestations alone — caller must have a fresh (≤ 5 min) audit.
pub const AARON_AUDIT_FRESHNESS_FOR_NFT_SECONDS: i64 = 300;

// ─── Pyth oracle feeds (mainnet) ───────────────────────────────────────────────
//
// Used by `mint_donor_nft` (SOL/USD) and the upcoming `jtx-buy-vault`
// (USDC/USD reference). Pinned to specific feed IDs; verify with
// `pyth.network/price-feeds` if Pyth migrates feed IDs.

/// Pyth SOL/USD price feed account on Solana mainnet (legacy Pythnet account
/// address). Kept for off-chain helper compatibility; on-chain code consumes
/// `PYTH_SOL_USD_FEED_ID` instead via `pyth-solana-receiver-sdk`.
pub const PYTH_SOL_USD_FEED: &str = "H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG";

/// Pyth USDC/USD price feed account on Solana mainnet (legacy). Same caveat
/// as above — on-chain code uses `PYTH_USDC_USD_FEED_ID`.
pub const PYTH_USDC_USD_FEED: &str = "Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD";

/// Pyth SOL/USD 32-byte feed ID (Hermes / pyth-solana-receiver-sdk format).
/// Hex: 0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d
/// Source: pyth.network/developers/price-feed-ids → Crypto.SOL/USD.
pub const PYTH_SOL_USD_FEED_ID: [u8; 32] = [
    0xef, 0x0d, 0x8b, 0x6f, 0xda, 0x2c, 0xeb, 0xa4,
    0x1d, 0xa1, 0x5d, 0x40, 0x95, 0xd1, 0xda, 0x39,
    0x2a, 0x0d, 0x2f, 0x8e, 0xd0, 0xc6, 0xc7, 0xbc,
    0x0f, 0x4c, 0xfa, 0xc8, 0xc2, 0x80, 0xb5, 0x6d,
];

/// Pyth USDC/USD 32-byte feed ID (Hermes / pyth-solana-receiver-sdk format).
/// Hex: 0xeaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a
/// Source: pyth.network/developers/price-feed-ids → Crypto.USDC/USD.
pub const PYTH_USDC_USD_FEED_ID: [u8; 32] = [
    0xea, 0xa0, 0x20, 0xc6, 0x1c, 0xc4, 0x79, 0x71,
    0x28, 0x13, 0x46, 0x1c, 0xe1, 0x53, 0x89, 0x4a,
    0x96, 0xa6, 0xc0, 0x0b, 0x21, 0xed, 0x0c, 0xfc,
    0x27, 0x98, 0xd1, 0xf9, 0xa9, 0xe9, 0xc9, 0x4a,
];

/// Reject Pyth prices older than this many seconds. Tight enough to catch
/// stale-oracle attacks, loose enough to survive minor RPC propagation lag.
pub const MAX_PYTH_AGE_SECONDS: u64 = 60;

// ─── Compile-time invariants ───────────────────────────────────────────────────
//
// Fail the build if anyone bumps a constant in a way that breaks the
// MOJO < DOJO < SPACE_COWBOY ordering or the OPTX mint cap monotonicity.

const _: () = {
    assert!(JTX_MOJO_THRESHOLD < JTX_DOJO_THRESHOLD);
    assert!(JTX_DOJO_THRESHOLD < JTX_SPACE_COWBOY_THRESHOLD);
    assert!(MOJO_MINT_CAP < DOJO_MINT_CAP);
    assert!(DOJO_MINT_CAP < SPACE_COWBOY_MINT_CAP);
    assert!(MOJO_DURATION_SECONDS < DOJO_DURATION_SECONDS);
    assert!(AARON_AUDIT_COOLDOWN_SECONDS < AARON_AUDIT_FRESHNESS_FOR_NFT_SECONDS);
};
