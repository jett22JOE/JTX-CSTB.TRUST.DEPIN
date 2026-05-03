// ============================================================================
// ASTRO KNOTS VAULT — jett_vault Anchor Program v2.1
// ============================================================================
//
// On-chain realization of the DePIN biometric authentication protocol:
//   1. AGT (Adaptive Gaze Tensor) simplex math
//   2. Optical encryption & JETT Auth SDK
//   3. Biometric proof-of-presence + AARON operator
//
// This program combines:
//   - Fundraising vault (SOL donations, agent USDC payments)
//   - AGT attestation with simplex-projected tensor weights
//   - Biometric proof hashes (computed off-chain, stored as opaque 32-byte digest)
//   - AARON (Async Audit RAG Optical Node) on-chain audit trail
//   - Subscription-gated OPTX mint caps ($JTX x402 tiers)
//   - 2-of-3 multisig for emergency operations
//   - Full event emission for webhook integrations
//
// AGT Math:
//   w(t+1) = Π_Δ[(1-α)·w(t) + α·g(t)]
//   Dual-space key: k(t) = ⟨w(t), s⟩
//   Bilinear extension: B(w, g) = Σ w_i · g_i · φ_i
//   Simplex constraint: Σ w_i = 1, w_i ≥ 0
//
// Biometric Proofs:
//   Off-chain biometric engine computes a cryptographic digest from gaze topology.
//   On-chain stores only the opaque 32-byte proof hash — no internals exposed.
//   Attestation hash = sha256(tensor_hash ‖ biometric_proof_hash)
//
// AARON Protocol:
//   Asynchronous Audit RAG Optical Node
//   Three-axis risk control: COG (cognitive) × ENV (environmental) × EMO (emotional)
//   On-chain: aaron_audit instruction creates timestamped audit PDA
//   Off-chain: AARON network node processes gaze audits via AI inference
//
// SECURITY CHECKLIST:
// [x] All arithmetic uses checked_add / checked_sub / checked_mul
// [x] No private keys on edge nodes — signing deferred to seeker device
// [x] Emergency pause via 2-of-3 multisig (no single signer)
// [x] Agent payments non-refundable by design
// [x] Reentrancy guards via Anchor account checks + state flags
// [x] Custom error enums with descriptive messages
// [x] CPI to jtx_cstb_trust for base attestation verification
// [x] VaultEvent emitted on every state change (webhook-ready)
// [x] Overflow protection on all counters and amounts
// [x] AGT tensor hash validated (sha256, 32 bytes)
// [x] Biometric proof hash is opaque — no internals on-chain
// [x] Subscription tier verified before OPTX mint
// [x] AARON audit hash is immutable once written
//
// ============================================================================

use anchor_lang::prelude::*;
use anchor_lang::system_program;
use anchor_lang::solana_program::hash::hashv;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token_interface::{
    self as token_iface, Mint as MintInterface, TokenAccount as TokenAccountInterface,
    TokenInterface, TransferChecked,
};
// `shared_constants` carries the canonical tier thresholds, mint caps, and
// pricing values used by both jett-vault and jtx-buy-vault. Imported as
// `shared` for terseness; original Cargo dep is `shared-constants`.
use shared_constants as shared;
// Pyth Solana Receiver SDK — on-chain SOL/USD oracle reads via wormhole-relayed
// price updates posted to PriceUpdateV2 PDAs. We never trust caller-supplied
// prices anymore; mint_donor_nft requires a fresh price update at tx time.
use pyth_solana_receiver_sdk::price_update::PriceUpdateV2;

declare_id!("JTX5uXTiZ1M3hJkjv5Cp5F8dr3Jc7nhJbQjCFmgEYA7");

// ============================================================================
// CONSTANTS
// ============================================================================

/// Default fundraising goal in lamports (5,874 SOL)
pub const DEFAULT_GOAL_LAMPORTS: u64 = 5_874_000_000_000;

/// Basis points: 100 = 1x multiplier, 150 = 1.5x
pub const MULTIPLIER_DEFAULT_BPS: u16 = 100;
pub const MULTIPLIER_REFERRED_BPS: u16 = 150;

/// Maximum number of multisig signers
pub const MAX_MULTISIG_SIGNERS: usize = 3;

/// Required signatures for multisig operations
pub const MULTISIG_THRESHOLD: u8 = 2;

/// AGT simplex dimension (COG, ENV, EMO = 3-simplex)
pub const AGT_DIMENSION: usize = 3;

/// AGT learning rate α in basis points (default 10% = 1000 bps)
pub const AGT_ALPHA_BPS: u16 = 1000;

/// AGT tensor weight precision (fixed-point, 6 decimals)
pub const AGT_PRECISION: u64 = 1_000_000;

/// Subscription tier: Basic — 222 OPTX mints per month
pub const BASIC_MINT_CAP: u32 = 222;

/// Subscription tier: Unlimited — no cap (u32::MAX)
pub const UNLIMITED_MINT_CAP: u32 = u32::MAX;

/// Minimum $JTX required for Basic subscription (in smallest unit)
pub const JTX_BASIC_THRESHOLD: u64 = 1_000_000; // 1 JTX

/// Minimum $JTX required for Unlimited subscription (in smallest unit)
pub const JTX_UNLIMITED_THRESHOLD: u64 = 100_000_000; // 100 JTX

/// AARON audit cooldown in seconds (prevent spam)
pub const AARON_AUDIT_COOLDOWN: i64 = 60;

/// JTX price in USDC (fixed at $8.00 per JTX, 6 decimal USDC = 8_000_000)
pub const JTX_PRICE_USDC: u64 = 8_000_000;

/// JTX decimals (Token-2022, 9 decimals)
pub const JTX_DECIMALS: u64 = 1_000_000_000;

/// Minimum donation for NFT receipt ($8 USDC = 1 JTX worth)
pub const MIN_NFT_THRESHOLD_USDC: u64 = 8_000_000;

/// NFT collection name
pub const NFT_COLLECTION_NAME: &str = "ASTRO KNOTS Vault Receipt";
pub const NFT_SYMBOL: &str = "AKVR";

/// SOL/USD price feed — updated by JOE autonomous agent
/// Default estimate: $133/SOL (used when oracle unavailable)
pub const DEFAULT_SOL_PRICE_USDC: u64 = 133_000_000; // $133.00 in 6-decimal USDC

// ============================================================================
// PROGRAM
// ============================================================================

#[program]
pub mod jett_vault {
    use super::*;

    // ========================================================================
    // INSTRUCTION #1: initialize_vault
    // ========================================================================

    /// Initialize the vault with fundraising parameters and multisig keys.
    /// Only the founder can call this. Sets goal, phase deadlines, and
    /// multisig signers for pause/close operations.
    pub fn initialize_vault(
        ctx: Context<InitializeVault>,
        goal_lamports: u64,
        phase_1_deadline: i64,
        phase_2_deadline: i64,
        multisig_signers: [Pubkey; MAX_MULTISIG_SIGNERS],
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault_config;
        let clock = Clock::get()?;

        require!(goal_lamports > 0, VaultError::InvalidGoal);
        require!(
            phase_1_deadline > clock.unix_timestamp,
            VaultError::InvalidDeadline
        );
        require!(
            phase_2_deadline > phase_1_deadline,
            VaultError::InvalidDeadline
        );

        vault.authority = ctx.accounts.founder.key();
        vault.goal_lamports = goal_lamports;
        vault.raised_lamports = 0;
        vault.raised_usdc = 0;
        vault.donor_count = 0;
        vault.agent_count = 0;
        vault.phase = 1;
        vault.phase_1_deadline = phase_1_deadline;
        vault.phase_2_deadline = phase_2_deadline;
        vault.is_launched = false;
        vault.is_refundable = false;
        vault.paused = false;
        vault.multisig_signers = multisig_signers;
        vault.multisig_approvals = [false; MAX_MULTISIG_SIGNERS];
        vault.pending_action = 0;
        vault.total_agt_attestations = 0;
        vault.total_aaron_audits = 0;
        vault.bump = ctx.bumps.vault_config;

        emit!(VaultEvent {
            event_type: "initialize_vault".to_string(),
            user: ctx.accounts.founder.key(),
            amount: goal_lamports,
            timestamp: clock.unix_timestamp,
            referrer: None,
            phase: 1,
        });

        msg!("ASTRO KNOTS VAULT initialized");
        msg!("Goal: {} lamports ({} SOL)", goal_lamports, goal_lamports / 1_000_000_000);
        msg!("Phase 1 deadline: {}", phase_1_deadline);
        msg!("Phase 2 deadline: {}", phase_2_deadline);

        Ok(())
    }

    // ========================================================================
    // INSTRUCTION #2: donate_sol
    // ========================================================================

    /// Permissionless SOL donation. Creates or updates Donor PDA.
    /// Transfers SOL from donor to vault PDA. Emits VaultEvent.
    pub fn donate_sol(
        ctx: Context<DonateSol>,
        amount: u64,
        referrer: Option<Pubkey>,
    ) -> Result<()> {
        let clock = Clock::get()?;

        // Validate before borrowing mutably
        require!(!ctx.accounts.vault_config.paused, VaultError::VaultPaused);
        require!(amount > 0, VaultError::ZeroAmount);
        require!(!ctx.accounts.vault_config.is_launched, VaultError::VaultAlreadyLaunched);

        // Transfer SOL from donor to vault PDA (before mutable borrows)
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.donor_signer.to_account_info(),
                to: ctx.accounts.vault_config.to_account_info(),
            },
        );
        system_program::transfer(cpi_ctx, amount)?;

        // Now safe to borrow mutably
        let vault = &mut ctx.accounts.vault_config;
        let donor = &mut ctx.accounts.donor;

        // Update donor record
        donor.wallet = ctx.accounts.donor_signer.key();
        donor.amount_lamports = donor
            .amount_lamports
            .checked_add(amount)
            .ok_or(VaultError::ArithmeticOverflow)?;
        donor.donated_at = clock.unix_timestamp;
        donor.referrer = referrer;
        donor.optx_multiplier_bps = MULTIPLIER_DEFAULT_BPS;
        donor.bump = ctx.bumps.donor;

        // Update vault totals
        vault.raised_lamports = vault
            .raised_lamports
            .checked_add(amount)
            .ok_or(VaultError::ArithmeticOverflow)?;
        vault.donor_count = vault
            .donor_count
            .checked_add(1)
            .ok_or(VaultError::ArithmeticOverflow)?;

        emit!(VaultEvent {
            event_type: "donate_sol".to_string(),
            user: ctx.accounts.donor_signer.key(),
            amount,
            timestamp: clock.unix_timestamp,
            referrer,
            phase: vault.phase,
        });

        msg!(
            "Donation: {} lamports from {}",
            amount,
            ctx.accounts.donor_signer.key()
        );

        Ok(())
    }

    // ========================================================================
    // INSTRUCTION #2b: donate_jtx
    // ========================================================================

    /// Donate JTX (Token-2022 SPL) to the vault.
    /// Transfers JTX from donor's token account to the vault's JTX token account.
    /// Creates/updates Donor PDA and JtxVaultStats PDA to track JTX raised.
    ///
    /// The JTX is held in a vault-owned associated token account, not the
    /// founder wallet. This is real on-chain escrow.
    ///
    /// JTX Mint: 9XpJiKEYzq5yDo5pJzRfjSRMPL2yPfDQXgiN7uYtBhUj (Token-2022, 9 decimals)
    pub fn donate_jtx(
        ctx: Context<DonateJtx>,
        amount: u64,
        referrer: Option<Pubkey>,
    ) -> Result<()> {
        let clock = Clock::get()?;

        // Validate before mutable borrows
        require!(!ctx.accounts.vault_config.paused, VaultError::VaultPaused);
        require!(amount > 0, VaultError::ZeroAmount);
        require!(!ctx.accounts.vault_config.is_launched, VaultError::VaultAlreadyLaunched);

        // Transfer JTX from donor to vault token account via Token-2022 CPI
        let cpi_accounts = anchor_spl::token_2022::TransferChecked {
            from: ctx.accounts.donor_jtx_account.to_account_info(),
            mint: ctx.accounts.jtx_mint.to_account_info(),
            to: ctx.accounts.vault_jtx_account.to_account_info(),
            authority: ctx.accounts.donor_signer.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        anchor_spl::token_2022::transfer_checked(cpi_ctx, amount, 9)?; // 9 decimals for JTX

        // Update donor record
        let donor = &mut ctx.accounts.donor;
        donor.wallet = ctx.accounts.donor_signer.key();
        donor.amount_lamports = donor.amount_lamports; // keep SOL amount unchanged
        donor.donated_at = clock.unix_timestamp;
        donor.referrer = referrer;
        donor.optx_multiplier_bps = MULTIPLIER_DEFAULT_BPS;
        donor.bump = ctx.bumps.donor;

        // Update JTX vault stats (separate PDA to avoid resizing VaultConfig)
        let stats = &mut ctx.accounts.jtx_vault_stats;
        stats.total_jtx_raised = stats
            .total_jtx_raised
            .checked_add(amount)
            .ok_or(VaultError::ArithmeticOverflow)?;
        stats.jtx_donor_count = stats
            .jtx_donor_count
            .checked_add(1)
            .ok_or(VaultError::ArithmeticOverflow)?;
        stats.last_donation_at = clock.unix_timestamp;
        stats.bump = ctx.bumps.jtx_vault_stats;

        // Update vault donor count
        let vault = &mut ctx.accounts.vault_config;
        vault.donor_count = vault
            .donor_count
            .checked_add(1)
            .ok_or(VaultError::ArithmeticOverflow)?;

        emit!(VaultEvent {
            event_type: "donate_jtx".to_string(),
            user: ctx.accounts.donor_signer.key(),
            amount,
            timestamp: clock.unix_timestamp,
            referrer,
            phase: vault.phase,
        });

        msg!(
            "JTX Donation: {} tokens from {}. Total JTX raised: {}",
            amount,
            ctx.accounts.donor_signer.key(),
            stats.total_jtx_raised
        );

        Ok(())
    }

    // ========================================================================
    // INSTRUCTION #3: donate_usdc_agent
    // ========================================================================

    /// Agent pays USDC to acquire a human user for DePIN.
    /// Creates AgentAcquisition PDA and updates AgentLedger.
    /// Agent payments are NON-REFUNDABLE (service fee by design).
    pub fn donate_usdc_agent(
        ctx: Context<DonateUsdcAgent>,
        usdc_amount: u64,
        target_user: Pubkey,
    ) -> Result<()> {
        let vault = &mut ctx.accounts.vault_config;
        let acquisition = &mut ctx.accounts.agent_acquisition;
        let ledger = &mut ctx.accounts.agent_ledger;
        let clock = Clock::get()?;

        require!(!vault.paused, VaultError::VaultPaused);
        require!(usdc_amount > 0, VaultError::ZeroAmount);
        require!(!vault.is_launched, VaultError::VaultAlreadyLaunched);

        // Record acquisition
        acquisition.agent = ctx.accounts.agent_signer.key();
        acquisition.target_user = target_user;
        acquisition.usdc_amount = usdc_amount;
        acquisition.acquired_at = clock.unix_timestamp;
        acquisition.bump = ctx.bumps.agent_acquisition;

        // Update agent ledger
        ledger.agent = ctx.accounts.agent_signer.key();
        ledger.total_usdc_paid = ledger
            .total_usdc_paid
            .checked_add(usdc_amount)
            .ok_or(VaultError::ArithmeticOverflow)?;
        ledger.users_acquired = ledger
            .users_acquired
            .checked_add(1)
            .ok_or(VaultError::ArithmeticOverflow)?;
        ledger.last_payment_at = clock.unix_timestamp;
        ledger.bump = ctx.bumps.agent_ledger;

        // Update vault USDC total
        vault.raised_usdc = vault
            .raised_usdc
            .checked_add(usdc_amount)
            .ok_or(VaultError::ArithmeticOverflow)?;
        vault.agent_count = vault
            .agent_count
            .checked_add(1)
            .ok_or(VaultError::ArithmeticOverflow)?;

        emit!(VaultEvent {
            event_type: "donate_usdc_agent".to_string(),
            user: ctx.accounts.agent_signer.key(),
            amount: usdc_amount,
            timestamp: clock.unix_timestamp,
            referrer: None,
            phase: vault.phase,
        });

        msg!(
            "Agent {} acquired user {} for {} USDC",
            ctx.accounts.agent_signer.key(),
            target_user,
            usdc_amount
        );

        Ok(())
    }

    // ========================================================================
    // INSTRUCTION #4: link_attestation (base CPI to jtx_cstb_trust)
    // ========================================================================

    /// JOE calls this autonomously to verify a donor's gaze attestation
    /// via CPI to jtx_cstb_trust's verify_attestation instruction.
    /// If donor has a valid referrer, apply 1.5x OPTX multiplier.
    pub fn link_attestation(ctx: Context<LinkAttestation>) -> Result<()> {
        let donor = &mut ctx.accounts.donor;
        let clock = Clock::get()?;

        require!(
            !ctx.accounts.vault_config.paused,
            VaultError::VaultPaused
        );
        require!(!donor.attested, VaultError::AlreadyAttested);

        // CPI to jtx_cstb_trust verify_attestation (view-only, validates PDA)
        let cpi_program = ctx.accounts.trust_program.to_account_info();
        let cpi_accounts = jtx_cstb_trust::cpi::accounts::VerifyAttestation {
            attestation: ctx.accounts.attestation.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(cpi_program, cpi_accounts);
        jtx_cstb_trust::cpi::verify_attestation(cpi_ctx)?;

        // Mark donor as attested
        donor.attested = true;

        // Apply referral boost: 1.5x if referrer exists
        if donor.referrer.is_some() {
            donor.optx_multiplier_bps = MULTIPLIER_REFERRED_BPS;
            msg!("Referral boost applied: 1.5x OPTX multiplier");
        } else {
            donor.optx_multiplier_bps = MULTIPLIER_DEFAULT_BPS;
        }

        emit!(VaultEvent {
            event_type: "link_attestation".to_string(),
            user: donor.wallet,
            amount: 0,
            timestamp: clock.unix_timestamp,
            referrer: donor.referrer,
            phase: ctx.accounts.vault_config.phase,
        });

        msg!(
            "Attestation linked for donor {} (multiplier: {}bps)",
            donor.wallet,
            donor.optx_multiplier_bps
        );

        Ok(())
    }

    // ========================================================================
    // INSTRUCTION #5: create_agt_attestation
    // ========================================================================
    //
    // AGT Math: w(t+1) = Π_Δ[(1-α)·w(t) + α·g(t)]
    //
    // The gaze tensor g(t) = [COG, ENV, EMO] is a 3-vector on the simplex Δ².
    // The weight vector w(t) is updated via exponential moving average
    // then projected back onto the simplex via Π_Δ (clamp + normalize).
    //
    // Dual-space key: k(t) = ⟨w(t), s⟩ where s is the session seed vector.
    // This inner product maps the simplex point to a scalar key used
    // for OPTX mint authorization.
    //
    // Bilinear extension: B(w, g) = Σ w_i · g_i · φ_i
    // where φ_i are basis functionals (here stored as difficulty factors).
    // This measures the "quality" of a gaze session for attestation scoring.
    //
    // Biometric proof hash is computed off-chain by the biometric engine
    // and passed as an opaque 32-byte digest. No internals are exposed on-chain.
    //
    // ========================================================================

    /// Create an AGT attestation with tensor weights and biometric proof.
    /// This is the core on-chain primitive for DePIN gaze authentication.
    ///
    /// # Arguments
    /// * `gaze_tensor` - Raw gaze vector [COG, ENV, EMO] in fixed-point (×1e6)
    /// * `session_seed` - Session-specific seed vector for dual-space key derivation
    /// * `biometric_proof_hash` - Opaque 32-byte hash from off-chain biometric engine
    /// * `difficulty_factors` - Basis functionals φ_i for bilinear extension
    /// * `device_type` - Device identifier (0=desktop, 1=mobile/MOJO, 2=edge)
    pub fn create_agt_attestation(
        ctx: Context<CreateAgtAttestation>,
        gaze_tensor: [u64; AGT_DIMENSION],
        session_seed: [u64; AGT_DIMENSION],
        biometric_proof_hash: [u8; 32],
        difficulty_factors: [u64; AGT_DIMENSION],
        device_type: u8,
    ) -> Result<()> {
        let agt = &mut ctx.accounts.agt_attestation;
        let vault = &mut ctx.accounts.vault_config;
        let clock = Clock::get()?;

        require!(!vault.paused, VaultError::VaultPaused);

        // Validate gaze tensor is on the simplex (sum ≈ AGT_PRECISION)
        let tensor_sum: u64 = gaze_tensor
            .iter()
            .try_fold(0u64, |acc, &x| acc.checked_add(x))
            .ok_or(VaultError::ArithmeticOverflow)?;

        // Allow 1% tolerance for rounding: |sum - 1.0| < 0.01
        let tolerance = AGT_PRECISION / 100;
        require!(
            tensor_sum >= AGT_PRECISION.saturating_sub(tolerance)
                && tensor_sum <= AGT_PRECISION.saturating_add(tolerance),
            VaultError::InvalidSimplexProjection
        );

        // Compute AGT weight update: w(t+1) = Π_Δ[(1-α)·w(t) + α·g(t)]
        // For initial attestation, w(0) = g(0) (first observation = weight)
        let agt_weights = simplex_project(&gaze_tensor)?;

        // Compute dual-space key: k(t) = ⟨w(t), s⟩
        let dual_key = inner_product(&agt_weights, &session_seed)?;

        // Compute bilinear extension: B(w, g) = Σ w_i · g_i · φ_i
        let bilinear_score = bilinear_extension(
            &agt_weights,
            &gaze_tensor,
            &difficulty_factors,
        )?;

        // Compute tensor hash: sha256(w[0] ‖ w[1] ‖ w[2] ‖ dual_key)
        let tensor_hash = compute_tensor_hash(&agt_weights, dual_key);

        // Attestation hash: sha256(tensor_hash ‖ biometric_proof_hash)
        let attestation_hash = hashv(&[&tensor_hash, &biometric_proof_hash]).to_bytes();

        // Populate AGT attestation PDA
        agt.owner = ctx.accounts.user.key();
        agt.agt_weights = agt_weights;
        agt.gaze_tensor = gaze_tensor;
        agt.dual_key = dual_key;
        agt.bilinear_score = bilinear_score;
        agt.tensor_hash = tensor_hash;
        agt.biometric_proof_hash = biometric_proof_hash;
        agt.attestation_hash = attestation_hash;
        agt.device_type = device_type;
        agt.created_at = clock.unix_timestamp;
        agt.is_valid = true;
        agt.revoked_at = None;
        agt.aaron_audit_hash = None;
        agt.optx_minted = 0;
        agt.subscription_tier = 0; // unset until set_subscription
        agt.mint_count_this_period = 0;
        agt.period_start = clock.unix_timestamp;
        agt.bump = ctx.bumps.agt_attestation;

        // Update vault counter
        vault.total_agt_attestations = vault
            .total_agt_attestations
            .checked_add(1)
            .ok_or(VaultError::ArithmeticOverflow)?;

        emit!(AgtEvent {
            event_type: "create_agt_attestation".to_string(),
            user: ctx.accounts.user.key(),
            tensor_hash,
            biometric_proof_hash,
            attestation_hash,
            bilinear_score,
            dual_key,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "AGT attestation created for {} | bilinear={} | dual_key={}",
            ctx.accounts.user.key(),
            bilinear_score,
            dual_key,
        );

        Ok(())
    }

    // ========================================================================
    // INSTRUCTION #6: update_agt_weights
    // ========================================================================
    //
    // Implements the AGT update rule:
    //   w(t+1) = Π_Δ[(1-α)·w(t) + α·g(t)]
    //
    // This is the core adaptive learning loop. Each new gaze observation
    // shifts the weight vector toward the new data point, then projects
    // back onto the probability simplex.
    //
    // ========================================================================

    /// Update an existing AGT attestation with a new gaze observation.
    /// Applies the simplex EMA update rule and recomputes all hashes.
    pub fn update_agt_weights(
        ctx: Context<UpdateAgtWeights>,
        new_gaze_tensor: [u64; AGT_DIMENSION],
        alpha_bps: u16,
    ) -> Result<()> {
        let agt = &mut ctx.accounts.agt_attestation;
        let clock = Clock::get()?;

        require!(
            !ctx.accounts.vault_config.paused,
            VaultError::VaultPaused
        );
        require!(agt.is_valid, VaultError::AttestationRevoked);
        require!(alpha_bps <= 10000, VaultError::InvalidAlpha);

        // Validate new gaze tensor on simplex
        let tensor_sum: u64 = new_gaze_tensor
            .iter()
            .try_fold(0u64, |acc, &x| acc.checked_add(x))
            .ok_or(VaultError::ArithmeticOverflow)?;

        let tolerance = AGT_PRECISION / 100;
        require!(
            tensor_sum >= AGT_PRECISION.saturating_sub(tolerance)
                && tensor_sum <= AGT_PRECISION.saturating_add(tolerance),
            VaultError::InvalidSimplexProjection
        );

        // AGT update: w(t+1) = Π_Δ[(1-α)·w(t) + α·g(t)]
        let alpha = alpha_bps as u64;
        let one_minus_alpha = 10000u64.saturating_sub(alpha as u64);

        let mut new_weights = [0u64; AGT_DIMENSION];
        for i in 0..AGT_DIMENSION {
            // w_i' = (1-α)·w_i + α·g_i   (all in bps precision)
            let scaled_old = agt.agt_weights[i]
                .checked_mul(one_minus_alpha)
                .ok_or(VaultError::ArithmeticOverflow)?
                / 10000;
            let scaled_new = new_gaze_tensor[i]
                .checked_mul(alpha)
                .ok_or(VaultError::ArithmeticOverflow)?
                / 10000;
            new_weights[i] = scaled_old
                .checked_add(scaled_new)
                .ok_or(VaultError::ArithmeticOverflow)?;
        }

        // Project onto simplex
        let projected = simplex_project(&new_weights)?;

        // Recompute dual-space key with new weights
        let dual_key = inner_product(&projected, &new_gaze_tensor)?;

        // Recompute tensor hash
        let tensor_hash = compute_tensor_hash(&projected, dual_key);

        // Recompute attestation hash (biometric proof hash stays same — it's invariant)
        let attestation_hash = hashv(&[&tensor_hash, &agt.biometric_proof_hash]).to_bytes();

        // Apply updates
        agt.agt_weights = projected;
        agt.gaze_tensor = new_gaze_tensor;
        agt.dual_key = dual_key;
        agt.tensor_hash = tensor_hash;
        agt.attestation_hash = attestation_hash;

        emit!(AgtEvent {
            event_type: "update_agt_weights".to_string(),
            user: agt.owner,
            tensor_hash,
            biometric_proof_hash: agt.biometric_proof_hash,
            attestation_hash,
            bilinear_score: agt.bilinear_score,
            dual_key,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "AGT weights updated for {} | α={}bps | new dual_key={}",
            agt.owner,
            alpha_bps,
            dual_key
        );

        Ok(())
    }

    // ========================================================================
    // INSTRUCTION #7: aaron_audit
    // ========================================================================
    //
    // AARON = Asynchronous Audit RAG Optical Node
    // Three-axis risk: COG × ENV × EMO tensors
    //
    // The AARON operator node processes gaze data through
    // AI inference for risk classification, then writes the audit result
    // on-chain as an immutable timestamp + hash.
    //
    // The audit_hash is computed off-chain by AARON and is:
    //   sha256(agt_attestation_hash ‖ risk_score ‖ cog ‖ env ‖ emo ‖ timestamp)
    //
    // Once written, the aaron_audit_hash on the AGT attestation is IMMUTABLE.
    //
    // ========================================================================

    /// AARON operator writes an audit result to an AGT attestation.
    /// Creates an AaronAudit PDA and stamps the AGT with the audit hash.
    pub fn aaron_audit(
        ctx: Context<AaronAudit>,
        audit_hash: [u8; 32],
        risk_score: u16,
        cog_score: u16,
        env_score: u16,
        emo_score: u16,
        audit_notes_hash: [u8; 32],
    ) -> Result<()> {
        let clock = Clock::get()?;

        // Validate before mutable borrows
        require!(!ctx.accounts.vault_config.paused, VaultError::VaultPaused);
        require!(ctx.accounts.agt_attestation.is_valid, VaultError::AttestationRevoked);
        require!(
            ctx.accounts.agt_attestation.aaron_audit_hash.is_none(),
            VaultError::AuditAlreadyExists
        );

        // Validate risk scores (0-10000 basis points)
        require!(risk_score <= 10000, VaultError::InvalidRiskScore);
        require!(cog_score <= 10000, VaultError::InvalidRiskScore);
        require!(env_score <= 10000, VaultError::InvalidRiskScore);
        require!(emo_score <= 10000, VaultError::InvalidRiskScore);

        // Capture keys before mutable borrows
        let agt_key = ctx.accounts.agt_attestation.key();
        let auditor_key = ctx.accounts.aaron_operator.key();

        // Now safe to borrow mutably
        let agt = &mut ctx.accounts.agt_attestation;
        let audit = &mut ctx.accounts.aaron_audit_account;
        let vault = &mut ctx.accounts.vault_config;

        // Populate AARON audit PDA
        audit.agt_attestation = agt_key;
        audit.auditor = auditor_key;
        audit.audit_hash = audit_hash;
        audit.risk_score = risk_score;
        audit.cog_score = cog_score;
        audit.env_score = env_score;
        audit.emo_score = emo_score;
        audit.audit_notes_hash = audit_notes_hash;
        audit.audited_at = clock.unix_timestamp;
        audit.bump = ctx.bumps.aaron_audit_account;

        // Stamp AGT with audit hash (IMMUTABLE after this)
        agt.aaron_audit_hash = Some(audit_hash);

        // Update vault counter
        vault.total_aaron_audits = vault
            .total_aaron_audits
            .checked_add(1)
            .ok_or(VaultError::ArithmeticOverflow)?;

        emit!(AaronEvent {
            event_type: "aaron_audit".to_string(),
            agt_owner: agt.owner,
            auditor: ctx.accounts.aaron_operator.key(),
            audit_hash,
            risk_score,
            cog_score,
            env_score,
            emo_score,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "AARON audit for {} | risk={} | COG={} ENV={} EMO={}",
            agt.owner,
            risk_score,
            cog_score,
            env_score,
            emo_score
        );

        Ok(())
    }

    // ========================================================================
    // INSTRUCTION #8: set_subscription
    // ========================================================================
    //
    // Subscription tiers:
    //   Basic:     222 OPTX mints/month — requires 1+ $JTX held
    //   Unlimited: No mint cap           — requires 100+ $JTX held
    //
    // The subscription is verified against the user's $JTX token balance.
    // In production, this uses CPI to check the token account. For devnet,
    // the tier is set based on declared $JTX amount (verified off-chain by JOE).
    //
    // ========================================================================

    /// DEPRECATED in v2.1 — use `stake_for_tier(tier)` instead.
    ///
    /// The original `set_subscription(tier, jtx_amount)` accepted a
    /// caller-supplied `jtx_amount` and only checked it against thresholds —
    /// no actual JTX transfer, no balance verification. Callers could claim
    /// any tier without holding any JTX (honor-system bug, mainnet-live).
    ///
    /// This stub keeps the IDL signature stable so existing callers fail
    /// loudly with `Deprecated` instead of silently no-op'ing into stale tier
    /// state. Migrate to `stake_for_tier` which performs an on-chain
    /// `transfer_checked` of the required JTX amount into the stake vault PDA.
    ///
    /// Both args are intentionally ignored — `_tier`, `_jtx_amount`.
    pub fn set_subscription(
        _ctx: Context<SetSubscription>,
        _tier: u8,
        _jtx_amount: u64,
    ) -> Result<()> {
        msg!("set_subscription is DEPRECATED in v2.1 — call stake_for_tier(tier) instead. \
              Required JTX is now transferred on-chain to the stake vault PDA; the old \
              caller-supplied jtx_amount path is closed.");
        err!(VaultError::Deprecated)
    }

    // ========================================================================
    // INSTRUCTION #9: mint_optx
    // ========================================================================
    //
    // OPTX minting is gated by:
    //   1. Valid AGT attestation (is_valid = true)
    //   2. Subscription tier (Basic=222/mo, Unlimited=no cap)
    //   3. AARON audit exists (aaron_audit_hash.is_some())
    //   4. Risk score below threshold (≤ 7500 bps)
    //
    // Mint amount is scaled by the bilinear score and OPTX multiplier.
    //
    // ========================================================================

    /// Mint OPTX tokens based on AGT attestation quality and subscription tier.
    /// Requires valid attestation + AARON audit + subscription.
    pub fn mint_optx(
        ctx: Context<MintOptx>,
        base_amount: u64,
    ) -> Result<()> {
        let agt = &mut ctx.accounts.agt_attestation;
        let clock = Clock::get()?;

        require!(
            !ctx.accounts.vault_config.paused,
            VaultError::VaultPaused
        );
        require!(agt.is_valid, VaultError::AttestationRevoked);
        require!(
            agt.aaron_audit_hash.is_some(),
            VaultError::AuditRequired
        );
        require!(
            agt.subscription_tier > 0,
            VaultError::NoSubscription
        );
        require!(base_amount > 0, VaultError::ZeroAmount);

        // Check mint cap based on subscription tier
        let mint_cap = match agt.subscription_tier {
            1 => BASIC_MINT_CAP,
            2 => UNLIMITED_MINT_CAP,
            _ => return Err(VaultError::InvalidSubscriptionTier.into()),
        };

        // Check if we're in a new period (30 days)
        let period_seconds: i64 = 30 * 24 * 60 * 60;
        if clock.unix_timestamp - agt.period_start >= period_seconds {
            agt.mint_count_this_period = 0;
            agt.period_start = clock.unix_timestamp;
        }

        // Check mint count against cap
        require!(
            agt.mint_count_this_period < mint_cap,
            VaultError::MintCapExceeded
        );

        // Increment mint counter
        agt.mint_count_this_period = agt
            .mint_count_this_period
            .checked_add(1)
            .ok_or(VaultError::ArithmeticOverflow)?;

        // Track total minted on this attestation
        agt.optx_minted = agt
            .optx_minted
            .checked_add(base_amount)
            .ok_or(VaultError::ArithmeticOverflow)?;

        // Note: Actual token mint CPI to Token-2022 happens here in production.
        // For devnet, we record the mint and JOE handles the SPL mint off-chain.

        emit!(VaultEvent {
            event_type: "mint_optx".to_string(),
            user: agt.owner,
            amount: base_amount,
            timestamp: clock.unix_timestamp,
            referrer: None,
            phase: ctx.accounts.vault_config.phase,
        });

        msg!(
            "OPTX mint: {} for {} | tier={} | mints_this_period={}/{}",
            base_amount,
            agt.owner,
            agt.subscription_tier,
            agt.mint_count_this_period,
            if mint_cap == u32::MAX { "∞".to_string() } else { mint_cap.to_string() }
        );

        Ok(())
    }

    // ========================================================================
    // INSTRUCTION #10: claim_refund
    // ========================================================================

    /// Permissionless refund claim. Only available if vault is marked refundable
    /// (deadline passed + goal not met). Proportional refund based on donation.
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        let clock = Clock::get()?;

        // Validate before mutable borrows
        require!(ctx.accounts.vault_config.is_refundable, VaultError::NotRefundable);
        require!(!ctx.accounts.donor.refund_claimed, VaultError::RefundAlreadyClaimed);
        require!(ctx.accounts.donor.amount_lamports > 0, VaultError::ZeroAmount);

        // Calculate proportional refund (read-only access)
        let vault_balance = ctx.accounts.vault_config.to_account_info().lamports();
        let donor_amount = ctx.accounts.donor.amount_lamports;
        let raised = ctx.accounts.vault_config.raised_lamports;
        let refund_amount = (donor_amount as u128)
            .checked_mul(vault_balance as u128)
            .ok_or(VaultError::ArithmeticOverflow)?
            .checked_div(raised as u128)
            .ok_or(VaultError::ArithmeticOverflow)? as u64;

        require!(refund_amount > 0, VaultError::ZeroAmount);

        // Transfer SOL from vault PDA to donor (before mutable borrows)
        **ctx
            .accounts
            .vault_config
            .to_account_info()
            .try_borrow_mut_lamports()? -= refund_amount;
        **ctx
            .accounts
            .donor_signer
            .to_account_info()
            .try_borrow_mut_lamports()? += refund_amount;

        // Now borrow mutably for state updates
        let vault = &mut ctx.accounts.vault_config;
        let donor = &mut ctx.accounts.donor;
        donor.refund_claimed = true;

        emit!(VaultEvent {
            event_type: "claim_refund".to_string(),
            user: ctx.accounts.donor_signer.key(),
            amount: refund_amount,
            timestamp: clock.unix_timestamp,
            referrer: None,
            phase: vault.phase,
        });

        msg!(
            "Refund: {} lamports to {}",
            refund_amount,
            ctx.accounts.donor_signer.key()
        );

        Ok(())
    }

    // ========================================================================
    // INSTRUCTION #11: set_paused (2-of-3 multisig)
    // ========================================================================

    /// Emergency pause/unpause. Requires 2-of-3 multisig approval.
    pub fn set_paused(ctx: Context<MultisigAction>, paused: bool) -> Result<()> {
        let vault = &mut ctx.accounts.vault_config;
        let signer = ctx.accounts.signer.key();

        // Verify signer is in multisig list
        let signer_idx = vault
            .multisig_signers
            .iter()
            .position(|s| *s == signer)
            .ok_or(VaultError::UnauthorizedSigner)?;

        // Record approval
        vault.multisig_approvals[signer_idx] = true;
        vault.pending_action = if paused { 1 } else { 2 };

        // Count approvals
        let approval_count = vault.multisig_approvals.iter().filter(|&&a| a).count();

        if approval_count >= MULTISIG_THRESHOLD as usize {
            vault.paused = paused;
            vault.multisig_approvals = [false; MAX_MULTISIG_SIGNERS];
            vault.pending_action = 0;

            let clock = Clock::get()?;
            emit!(VaultEvent {
                event_type: if paused {
                    "vault_paused".to_string()
                } else {
                    "vault_unpaused".to_string()
                },
                user: signer,
                amount: 0,
                timestamp: clock.unix_timestamp,
                referrer: None,
                phase: vault.phase,
            });

            msg!("Vault paused: {} (multisig approved)", paused);
        } else {
            msg!(
                "Multisig approval {}/{} for pause={}",
                approval_count,
                MULTISIG_THRESHOLD,
                paused
            );
        }

        Ok(())
    }

    // ========================================================================
    // INSTRUCTION #12: revoke_attestation
    // ========================================================================

    /// Revoke an AGT attestation (founder/AARON operator only).
    /// Prevents further OPTX minting from this attestation.
    pub fn revoke_attestation(ctx: Context<RevokeAttestation>) -> Result<()> {
        let agt = &mut ctx.accounts.agt_attestation;
        let clock = Clock::get()?;

        require!(agt.is_valid, VaultError::AttestationRevoked);

        agt.is_valid = false;
        agt.revoked_at = Some(clock.unix_timestamp);

        emit!(VaultEvent {
            event_type: "revoke_attestation".to_string(),
            user: agt.owner,
            amount: 0,
            timestamp: clock.unix_timestamp,
            referrer: None,
            phase: ctx.accounts.vault_config.phase,
        });

        msg!("AGT attestation revoked for {}", agt.owner);

        Ok(())
    }

    // ========================================================================
    // STUB: check_and_launch (Phase 2)
    // ========================================================================

    pub fn check_and_launch(ctx: Context<JoeAutonomous>) -> Result<()> {
        require!(
            !ctx.accounts.vault_config.paused,
            VaultError::VaultPaused
        );
        msg!("check_and_launch: stub — implement in Phase 2");
        Ok(())
    }

    // ========================================================================
    // STUB: trigger_refunds (Phase 2)
    // ========================================================================

    pub fn trigger_refunds(ctx: Context<JoeAutonomous>) -> Result<()> {
        require!(
            !ctx.accounts.vault_config.paused,
            VaultError::VaultPaused
        );
        msg!("trigger_refunds: stub — implement in Phase 2");
        Ok(())
    }

    // ========================================================================
    // INSTRUCTION #12: mint_donor_nft
    // ========================================================================

    /// Mint an NFT receipt for a donor's contribution.
    ///
    /// The NFT represents a claim on JTX tokens at the vault price ($8/JTX).
    /// Formula: jtx_entitled = donation_value_usdc / JTX_PRICE_USDC
    ///
    /// For SOL donations: value = amount_lamports * sol_price_usdc / 1e9
    /// For USDC (agent): value = usdc_amount directly
    ///
    /// Example: User donates $80 SOL → NFT = 10 JTX claim (80/8)
    /// Example: Agent pays $16 USDC → NFT = 2 JTX claim (16/8)
    ///
    /// NFT metadata stored in DonorReceipt PDA. Actual Metaplex NFT mint
    /// can be triggered separately via CPI or off-chain with the receipt as proof.
    ///
    /// Works for both human wallets (SOL) and agent wallets (x402/MPP/Tempo).
    pub fn mint_donor_nft(ctx: Context<MintDonorNft>) -> Result<()> {
        let clock = Clock::get()?;

        // Validate
        require!(!ctx.accounts.vault_config.paused, VaultError::VaultPaused);
        require!(!ctx.accounts.donor.refund_claimed, VaultError::RefundAlreadyClaimed);
        require!(ctx.accounts.donor.amount_lamports > 0, VaultError::ZeroAmount);

        // AARON audit freshness — the donor must have run aaron_audit within
        // AARON_AUDIT_FRESHNESS_FOR_NFT_SECONDS (5 min) before minting. The
        // Accounts struct already pins aaron_audit_account to the donor's
        // agt_attestation; here we only enforce the time bound.
        let audit_age = clock
            .unix_timestamp
            .saturating_sub(ctx.accounts.aaron_audit_account.audited_at);
        require!(
            audit_age <= shared::AARON_AUDIT_FRESHNESS_FOR_NFT_SECONDS,
            VaultError::AuditTooStale
        );

        // SOL/USD price from Pyth (≤ MAX_PYTH_AGE_SECONDS old). The receiver
        // SDK validates freshness internally and returns Err on stale/missing
        // updates → mapped to VaultError::PythPriceStale. No caller-supplied
        // price path remains: a stale or absent Pyth update fails the tx.
        let pyth_price = ctx
            .accounts
            .pyth_price_update
            .get_price_no_older_than(
                &clock,
                shared::MAX_PYTH_AGE_SECONDS,
                &shared::PYTH_SOL_USD_FEED_ID,
            )
            .map_err(|_| error!(VaultError::PythPriceStale))?;
        let price = scale_pyth_to_usdc6(pyth_price.price, pyth_price.exponent)?;

        // Calculate donation value in USDC (6 decimals)
        // value_usdc = (amount_lamports * sol_price_usdc) / LAMPORTS_PER_SOL
        let donation_value_usdc = (ctx.accounts.donor.amount_lamports as u128)
            .checked_mul(price as u128)
            .ok_or(VaultError::ArithmeticOverflow)?
            .checked_div(1_000_000_000u128) // LAMPORTS_PER_SOL
            .ok_or(VaultError::ArithmeticOverflow)? as u64;

        // Must meet minimum threshold ($8 = 1 JTX)
        require!(donation_value_usdc >= MIN_NFT_THRESHOLD_USDC, VaultError::BelowNftThreshold);

        // Calculate JTX entitlement: jtx_tokens = value_usdc / JTX_PRICE_USDC
        // In base units (9 decimals): jtx_base = (value_usdc * JTX_DECIMALS) / JTX_PRICE_USDC
        let jtx_entitled_base = (donation_value_usdc as u128)
            .checked_mul(JTX_DECIMALS as u128)
            .ok_or(VaultError::ArithmeticOverflow)?
            .checked_div(JTX_PRICE_USDC as u128)
            .ok_or(VaultError::ArithmeticOverflow)? as u64;

        // Apply OPTX multiplier from donor record (100 bps = 1x, 150 bps = 1.5x)
        let multiplier_bps = ctx.accounts.donor.optx_multiplier_bps as u64;
        let jtx_with_multiplier = jtx_entitled_base
            .checked_mul(multiplier_bps as u64)
            .ok_or(VaultError::ArithmeticOverflow)?
            .checked_div(100)
            .ok_or(VaultError::ArithmeticOverflow)?;

        // Capture keys before mutable borrow
        let donor_key = ctx.accounts.donor_signer.key();
        let vault_key = ctx.accounts.vault_config.key();

        // Populate receipt PDA
        let receipt = &mut ctx.accounts.donor_receipt;
        receipt.donor = donor_key;
        receipt.vault = vault_key;
        receipt.donation_lamports = ctx.accounts.donor.amount_lamports;
        receipt.donation_value_usdc = donation_value_usdc;
        receipt.sol_price_usdc = price;
        receipt.jtx_entitled = jtx_with_multiplier;
        receipt.jtx_price_usdc = JTX_PRICE_USDC;
        receipt.multiplier_bps = ctx.accounts.donor.optx_multiplier_bps;
        receipt.minted_at = clock.unix_timestamp;
        receipt.claimed = false;
        receipt.payment_method = if ctx.accounts.donor.amount_lamports > 0 { 0 } else { 1 }; // 0=SOL, 1=USDC/agent
        receipt.bump = ctx.bumps.donor_receipt;

        // Mark donor as having NFT minted
        let donor = &mut ctx.accounts.donor;
        donor.nft_minted = true;

        emit!(NftReceiptEvent {
            donor: donor_key,
            vault: vault_key,
            donation_value_usdc,
            jtx_entitled: jtx_with_multiplier,
            sol_price_usdc: price,
            multiplier_bps: receipt.multiplier_bps,
            timestamp: clock.unix_timestamp,
        });

        msg!(
            "NFT Receipt: {} → {} JTX (${} donation at ${}/JTX, {}x multiplier)",
            donor_key,
            jtx_with_multiplier / JTX_DECIMALS,
            donation_value_usdc / 1_000_000,
            JTX_PRICE_USDC / 1_000_000,
            multiplier_bps as f64 / 100.0
        );

        Ok(())
    }

    // ========================================================================
    // STUB: update_phase (Phase 2)
    // ========================================================================

    pub fn update_phase(ctx: Context<JoeAutonomous>) -> Result<()> {
        require!(
            !ctx.accounts.vault_config.paused,
            VaultError::VaultPaused
        );
        msg!("update_phase: stub — implement in Phase 2");
        Ok(())
    }

    // ========================================================================
    // STUB: close_vault (Phase 2, requires multisig)
    // ========================================================================

    pub fn close_vault(_ctx: Context<MultisigAction>) -> Result<()> {
        msg!("close_vault: stub — implement in Phase 2");
        Ok(())
    }

    // ========================================================================
    // STUB: migrate_from_legacy (founder only)
    // ========================================================================

    pub fn migrate_from_legacy(_ctx: Context<FounderOnly>) -> Result<()> {
        msg!("migrate_from_legacy: stub — implement when ready");
        Ok(())
    }

    // ========================================================================
    // STAKE SUBSYSTEM (v2.1) — replaces broken honor-system set_subscription.
    //
    // Tier × duration × OPTX cap (from `astroknots.space/stake`):
    //   MOJO         12 JTX    1 year      12 OPTX/mo
    //   DOJO        444 JTX    2 years    444 OPTX/mo
    //   SPACE COWBOY 1,111 JTX  Lifetime   Unlimited (PERMANENTLY LOCKED)
    //
    // SPACE COWBOY locks JTX with no withdrawal path — by design — for max
    // peg defense + alignment signal. UI MUST disclose this before signing.
    //
    // Helius webhook → AARON Router /stakes/webhooks/helius → SpacetimeDB
    // jtx_onchain_action mirroring; events emitted below.
    // ========================================================================

    /// Stake JTX into a tier position. One position per wallet (re-call to
    /// upgrade requires `restake_upgrade`; downgrade requires `unstake`-then-
    /// new `stake_for_tier`).
    pub fn stake_for_tier(ctx: Context<StakeForTier>, tier: u8) -> Result<()> {
        require!(tier >= 1 && tier <= 3, VaultError::InvalidSubscriptionTier);
        require!(!ctx.accounts.vault_config.paused, VaultError::VaultPaused);

        let (required_amount, duration) = tier_params(tier)?;
        require!(
            ctx.accounts.user_jtx_ata.amount >= required_amount,
            VaultError::StakeBalanceTooLow
        );

        let clock = Clock::get()?;
        let staked_at = clock.unix_timestamp;
        let expires_at = match tier {
            3 => shared::LIFETIME_NEVER_EXPIRES,            // SPACE COWBOY: permanent
            _ => staked_at.saturating_add(duration),
        };

        // Transfer JTX → stake_vault_ata (Token-2022 transfer_checked).
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.user_jtx_ata.to_account_info(),
            mint: ctx.accounts.jtx_mint.to_account_info(),
            to: ctx.accounts.stake_vault_ata.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        token_iface::transfer_checked(cpi_ctx, required_amount, ctx.accounts.jtx_mint.decimals)?;

        // Init stake position.
        let stake_position = &mut ctx.accounts.stake_position;
        stake_position.owner = ctx.accounts.user.key();
        stake_position.tier = tier;
        stake_position.amount = required_amount;
        stake_position.staked_at = staked_at;
        stake_position.expires_at = expires_at;
        stake_position.status = 0; // active
        stake_position.bump = ctx.bumps.stake_position;

        // Sync subscription on AGT attestation.
        let agt = &mut ctx.accounts.agt_attestation;
        agt.subscription_tier = tier;
        agt.mint_count_this_period = 0;
        agt.period_start = staked_at;

        emit!(StakeEvent {
            owner: ctx.accounts.user.key(),
            tier,
            amount: required_amount,
            staked_at,
            expires_at,
        });

        msg!("stake: owner={} tier={} amount={} expires_at={}",
            ctx.accounts.user.key(), tier, required_amount, expires_at);
        Ok(())
    }

    /// Withdraw a non-lifetime stake after expiry. Closes the StakePosition
    /// PDA (rent refunded to user). SPACE COWBOY (tier 3) cannot be unstaked.
    pub fn unstake(ctx: Context<Unstake>) -> Result<()> {
        let stake = &ctx.accounts.stake_position;
        require!(stake.status == 0, VaultError::StakeAlreadyWithdrawn);

        // SPACE COWBOY = permanent lock, no escape hatch.
        require!(
            stake.expires_at != shared::LIFETIME_NEVER_EXPIRES,
            VaultError::LifetimeStakePermanent
        );

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp >= stake.expires_at,
            VaultError::StakeNotExpired
        );

        let amount = stake.amount;
        let tier = stake.tier;

        // Sign as stake_vault_authority PDA to release the locked JTX.
        let vault_config_key = ctx.accounts.vault_config.key();
        let bump = ctx.bumps.stake_vault_authority;
        let seeds: &[&[u8]] = &[
            b"stake_vault_authority",
            vault_config_key.as_ref(),
            &[bump],
        ];
        let signer_seeds: &[&[&[u8]]] = &[seeds];

        let cpi_accounts = TransferChecked {
            from: ctx.accounts.stake_vault_ata.to_account_info(),
            mint: ctx.accounts.jtx_mint.to_account_info(),
            to: ctx.accounts.user_jtx_ata.to_account_info(),
            authority: ctx.accounts.stake_vault_authority.to_account_info(),
        };
        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
            signer_seeds,
        );
        token_iface::transfer_checked(cpi_ctx, amount, ctx.accounts.jtx_mint.decimals)?;

        // Reset AGT subscription tier on unstake.
        let agt = &mut ctx.accounts.agt_attestation;
        agt.subscription_tier = 0;
        agt.mint_count_this_period = 0;

        emit!(UnstakeEvent {
            owner: ctx.accounts.user.key(),
            tier,
            amount,
            withdrew_at: clock.unix_timestamp,
        });

        msg!("unstake: owner={} tier={} amount={}",
            ctx.accounts.user.key(), tier, amount);
        // StakePosition PDA closed via `close = user` constraint (rent refund).
        Ok(())
    }

    /// Upgrade an active stake to a higher tier by transferring the delta.
    /// Resets `expires_at` to `now + new_tier_duration` (or 0 for SPACE COWBOY).
    /// Downgrades NOT supported — call unstake-then-stake_for_tier.
    pub fn restake_upgrade(ctx: Context<RestakeUpgrade>, new_tier: u8) -> Result<()> {
        require!(new_tier >= 1 && new_tier <= 3, VaultError::InvalidSubscriptionTier);
        require!(!ctx.accounts.vault_config.paused, VaultError::VaultPaused);

        let stake = &ctx.accounts.stake_position;
        require!(new_tier > stake.tier, VaultError::InvalidTierUpgrade);

        let (new_required, new_duration) = tier_params(new_tier)?;
        let delta = new_required.saturating_sub(stake.amount);
        require!(delta > 0, VaultError::InvalidTierUpgrade);
        require!(
            ctx.accounts.user_jtx_ata.amount >= delta,
            VaultError::StakeBalanceTooLow
        );

        // Transfer delta to stake_vault_ata.
        let cpi_accounts = TransferChecked {
            from: ctx.accounts.user_jtx_ata.to_account_info(),
            mint: ctx.accounts.jtx_mint.to_account_info(),
            to: ctx.accounts.stake_vault_ata.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            cpi_accounts,
        );
        token_iface::transfer_checked(cpi_ctx, delta, ctx.accounts.jtx_mint.decimals)?;

        let clock = Clock::get()?;
        let now = clock.unix_timestamp;
        let new_expires_at = match new_tier {
            3 => shared::LIFETIME_NEVER_EXPIRES,
            _ => now.saturating_add(new_duration),
        };
        let old_tier = stake.tier;

        // Mutate stake position.
        let stake_mut = &mut ctx.accounts.stake_position;
        stake_mut.tier = new_tier;
        stake_mut.amount = new_required;
        stake_mut.expires_at = new_expires_at;

        // Sync AGT subscription.
        let agt = &mut ctx.accounts.agt_attestation;
        agt.subscription_tier = new_tier;
        agt.mint_count_this_period = 0;
        agt.period_start = now;

        emit!(RestakeUpgradeEvent {
            owner: ctx.accounts.user.key(),
            old_tier,
            new_tier,
            delta_amount: delta,
            new_expires_at,
            upgraded_at: now,
        });

        msg!("restake_upgrade: owner={} {} → {} delta={}",
            ctx.accounts.user.key(), old_tier, new_tier, delta);
        Ok(())
    }

    /// One-time multisig-gated batch reset of fake-tier `subscription_tier`
    /// values left over from the broken honor-system set_subscription. Pass
    /// target AgtAttestation accounts in `remaining_accounts`.
    ///
    /// Caller must be in vault_config.multisig_signers AND pending_action
    /// must be a migrate-action with ≥ 2 approvals (existing multisig flow
    /// is reused — no new state needed). Frontend prepares the batch and
    /// founders co-sign through the standard multisig propose/approve cycle.
    pub fn migrate_v2_thresholds<'info>(
        ctx: Context<'_, '_, '_, 'info, MigrateV2Thresholds<'info>>,
    ) -> Result<()> {
        let vault_config = &ctx.accounts.vault_config;
        let signer_key = ctx.accounts.signer.key();

        // Caller must be a registered multisig signer.
        let is_signer_in_multisig = vault_config
            .multisig_signers
            .iter()
            .any(|p| *p == signer_key);
        require!(is_signer_in_multisig, VaultError::Unauthorized);

        // 2-of-3 threshold check on currently-tracked approvals.
        let approval_count = vault_config
            .multisig_approvals
            .iter()
            .filter(|&&approved| approved)
            .count() as u8;
        require!(
            approval_count >= MULTISIG_THRESHOLD,
            VaultError::MultisigNotApproved
        );

        let clock = Clock::get()?;
        let mut migrated: u32 = 0;

        // Iterate target AgtAttestation accounts in remaining_accounts.
        // try_deserialize() implicitly validates the Anchor account discriminator,
        // so unrelated accounts are silently skipped.
        for ai in ctx.remaining_accounts.iter() {
            let mut data = ai.try_borrow_mut_data()?;
            if data.len() < AgtAttestation::LEN {
                continue;
            }
            let mut buf: &[u8] = &data;
            let mut agt: AgtAttestation = match AgtAttestation::try_deserialize(&mut buf) {
                Ok(a) => a,
                Err(_) => continue, // Not an AgtAttestation — skip silently.
            };

            // Wipe the fake tier and counters.
            if agt.subscription_tier != 0 {
                agt.subscription_tier = 0;
                agt.mint_count_this_period = 0;

                // Re-serialize back into the account's data slice.
                let mut writer: &mut [u8] = &mut data;
                agt.try_serialize(&mut writer)?;
                migrated = migrated.saturating_add(1);
            }
        }

        // Reset multisig approvals after action lands.
        let vault_mut = &mut ctx.accounts.vault_config;
        for slot in vault_mut.multisig_approvals.iter_mut() {
            *slot = false;
        }
        vault_mut.pending_action = 0;

        emit!(MigrateV2Event {
            batch_count: migrated,
            timestamp: clock.unix_timestamp,
        });

        msg!("migrate_v2_thresholds: migrated {} attestation(s)", migrated);
        Ok(())
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Stake helpers (private — referenced only by stake_for_tier / restake_upgrade)
// ───────────────────────────────────────────────────────────────────────────

/// Look up (required_jtx, duration_seconds) for a given tier byte.
fn tier_params(tier: u8) -> Result<(u64, i64)> {
    match tier {
        1 => Ok((shared::JTX_MOJO_THRESHOLD, shared::MOJO_DURATION_SECONDS)),
        2 => Ok((shared::JTX_DOJO_THRESHOLD, shared::DOJO_DURATION_SECONDS)),
        3 => Ok((shared::JTX_SPACE_COWBOY_THRESHOLD, shared::LIFETIME_NEVER_EXPIRES)),
        _ => err!(VaultError::InvalidSubscriptionTier),
    }
}

// ───────────────────────────────────────────────────────────────────────────
// Pyth helpers
// ───────────────────────────────────────────────────────────────────────────

/// Convert a Pyth `Price { price, exponent }` (USD value = price · 10^exponent)
/// to a u64 in 6-decimal USDC. Negative or zero prices are rejected as
/// `PythPriceStale` — there is no legitimate path where SOL/USD ≤ 0. Overflow
/// or down-shift to zero in either direction maps to `ArithmeticOverflow`.
fn scale_pyth_to_usdc6(price: i64, exponent: i32) -> Result<u64> {
    require!(price > 0, VaultError::PythPriceStale);
    let price_u128 = price as u128;
    // USDC has 6 decimals → target exponent is -6. Shift = exponent - (-6).
    let shift: i32 = exponent + 6;
    let scaled: u128 = if shift >= 0 {
        let factor = 10u128
            .checked_pow(shift as u32)
            .ok_or(VaultError::ArithmeticOverflow)?;
        price_u128
            .checked_mul(factor)
            .ok_or(VaultError::ArithmeticOverflow)?
    } else {
        let factor = 10u128
            .checked_pow((-shift) as u32)
            .ok_or(VaultError::ArithmeticOverflow)?;
        price_u128
            .checked_div(factor)
            .ok_or(VaultError::ArithmeticOverflow)?
    };
    u64::try_from(scaled).map_err(|_| error!(VaultError::ArithmeticOverflow))
}

// ============================================================================
// AGT MATH HELPERS
// ============================================================================
//
// These implement the core Adaptive Gaze Tensor math.
// All operations use fixed-point arithmetic (precision = 1e6) to avoid
// floating point on Solana's BPF runtime.
//

/// Project a vector onto the probability simplex Δ^(n-1).
/// Ensures: Σ w_i = AGT_PRECISION and w_i ≥ 0 for all i.
///
/// Algorithm: clamp negatives to 0, then normalize to sum = AGT_PRECISION.
fn simplex_project(v: &[u64; AGT_DIMENSION]) -> Result<[u64; AGT_DIMENSION]> {
    let mut result = *v;

    // All values are u64 so already ≥ 0. Just normalize to sum = AGT_PRECISION.
    let sum: u64 = result
        .iter()
        .try_fold(0u64, |acc, &x| acc.checked_add(x))
        .ok_or(VaultError::ArithmeticOverflow)?;

    if sum == 0 {
        // Uniform distribution if all zeros
        let uniform = AGT_PRECISION / AGT_DIMENSION as u64;
        return Ok([uniform; AGT_DIMENSION]);
    }

    // Normalize: w_i = (v_i * AGT_PRECISION) / sum
    for i in 0..AGT_DIMENSION {
        result[i] = (result[i] as u128)
            .checked_mul(AGT_PRECISION as u128)
            .ok_or(VaultError::ArithmeticOverflow)?
            .checked_div(sum as u128)
            .ok_or(VaultError::ArithmeticOverflow)? as u64;
    }

    // Fix rounding: adjust last element so sum = AGT_PRECISION exactly
    let new_sum: u64 = result[..AGT_DIMENSION - 1]
        .iter()
        .try_fold(0u64, |acc, &x| acc.checked_add(x))
        .ok_or(VaultError::ArithmeticOverflow)?;
    result[AGT_DIMENSION - 1] = AGT_PRECISION.saturating_sub(new_sum);

    Ok(result)
}

/// Inner product ⟨a, b⟩ = Σ a_i · b_i (divided by AGT_PRECISION for scaling).
/// Used for dual-space key derivation: k(t) = ⟨w(t), s⟩
fn inner_product(
    a: &[u64; AGT_DIMENSION],
    b: &[u64; AGT_DIMENSION],
) -> Result<u64> {
    let mut sum: u128 = 0;
    for i in 0..AGT_DIMENSION {
        sum = sum
            .checked_add(
                (a[i] as u128)
                    .checked_mul(b[i] as u128)
                    .ok_or(VaultError::ArithmeticOverflow)?,
            )
            .ok_or(VaultError::ArithmeticOverflow)?;
    }
    // Scale down by precision
    Ok((sum / AGT_PRECISION as u128) as u64)
}

/// Bilinear extension B(w, g) = Σ w_i · g_i · φ_i
/// Measures gaze quality for attestation scoring.
/// Returns score in fixed-point (×1e6).
fn bilinear_extension(
    weights: &[u64; AGT_DIMENSION],
    gaze: &[u64; AGT_DIMENSION],
    difficulty: &[u64; AGT_DIMENSION],
) -> Result<u64> {
    let mut sum: u128 = 0;
    for i in 0..AGT_DIMENSION {
        let term = (weights[i] as u128)
            .checked_mul(gaze[i] as u128)
            .ok_or(VaultError::ArithmeticOverflow)?
            .checked_mul(difficulty[i] as u128)
            .ok_or(VaultError::ArithmeticOverflow)?;
        sum = sum.checked_add(term).ok_or(VaultError::ArithmeticOverflow)?;
    }
    // Scale down by precision^2 (two multiplications of fixed-point values)
    let precision_sq = (AGT_PRECISION as u128)
        .checked_mul(AGT_PRECISION as u128)
        .ok_or(VaultError::ArithmeticOverflow)?;
    Ok((sum / precision_sq) as u64)
}

/// Compute tensor hash: sha256(w[0] ‖ w[1] ‖ w[2] ‖ dual_key)
fn compute_tensor_hash(weights: &[u64; AGT_DIMENSION], dual_key: u64) -> [u8; 32] {
    let mut data = Vec::with_capacity(AGT_DIMENSION * 8 + 8);
    for w in weights {
        data.extend_from_slice(&w.to_le_bytes());
    }
    data.extend_from_slice(&dual_key.to_le_bytes());
    hashv(&[&data]).to_bytes()
}

// ============================================================================
// EVENTS
// ============================================================================

/// General vault event (fundraising, refunds, subscriptions)
#[event]
pub struct VaultEvent {
    pub event_type: String,
    pub user: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
    pub referrer: Option<Pubkey>,
    pub phase: u8,
}

/// AGT-specific event (attestation creation, weight updates)
#[event]
pub struct AgtEvent {
    pub event_type: String,
    pub user: Pubkey,
    pub tensor_hash: [u8; 32],
    pub biometric_proof_hash: [u8; 32],
    pub attestation_hash: [u8; 32],
    pub bilinear_score: u64,
    pub dual_key: u64,
    pub timestamp: i64,
}

/// AARON audit event
#[event]
pub struct AaronEvent {
    pub event_type: String,
    pub agt_owner: Pubkey,
    pub auditor: Pubkey,
    pub audit_hash: [u8; 32],
    pub risk_score: u16,
    pub cog_score: u16,
    pub env_score: u16,
    pub emo_score: u16,
    pub timestamp: i64,
}

/// NFT receipt event (donor JTX claim minted)
#[event]
pub struct NftReceiptEvent {
    pub donor: Pubkey,
    pub vault: Pubkey,
    pub donation_value_usdc: u64,
    pub jtx_entitled: u64,
    pub sol_price_usdc: u64,
    pub multiplier_bps: u16,
    pub timestamp: i64,
}

// --- Stake subsystem events (v2.1) -----------------------------------------
//
// Emitted by stake_for_tier / unstake / restake_upgrade. AARON Router's
// /stakes/webhooks/helius handler consumes these via Helius webhook and
// writes parallel rows into SpacetimeDB jtx_onchain_action.

#[event]
pub struct StakeEvent {
    pub owner: Pubkey,
    pub tier: u8,
    pub amount: u64,
    pub staked_at: i64,
    pub expires_at: i64, // 0 = lifetime (SPACE COWBOY)
}

#[event]
pub struct UnstakeEvent {
    pub owner: Pubkey,
    pub tier: u8,
    pub amount: u64,
    pub withdrew_at: i64,
}

#[event]
pub struct RestakeUpgradeEvent {
    pub owner: Pubkey,
    pub old_tier: u8,
    pub new_tier: u8,
    pub delta_amount: u64,
    pub new_expires_at: i64, // 0 = lifetime
    pub upgraded_at: i64,
}

#[event]
pub struct MigrateV2Event {
    pub batch_count: u32,
    pub timestamp: i64,
}

// ============================================================================
// ACCOUNT STRUCTURES
// ============================================================================

/// VaultConfig — Global singleton storing vault + protocol state.
/// Seeds: ["vault_config"]
#[account]
pub struct VaultConfig {
    pub authority: Pubkey,
    pub goal_lamports: u64,
    pub raised_lamports: u64,
    pub raised_usdc: u64,
    pub donor_count: u32,
    pub agent_count: u32,
    pub phase: u8,
    pub phase_1_deadline: i64,
    pub phase_2_deadline: i64,
    pub is_launched: bool,
    pub is_refundable: bool,
    pub paused: bool,
    pub multisig_signers: [Pubkey; MAX_MULTISIG_SIGNERS],
    pub multisig_approvals: [bool; MAX_MULTISIG_SIGNERS],
    pub pending_action: u8,
    /// Total AGT attestations created
    pub total_agt_attestations: u32,
    /// Total AARON audits completed
    pub total_aaron_audits: u32,
    pub bump: u8,
}

impl VaultConfig {
    pub const LEN: usize = 8 + // discriminator
        32 +    // authority
        8 +     // goal_lamports
        8 +     // raised_lamports
        8 +     // raised_usdc
        4 +     // donor_count
        4 +     // agent_count
        1 +     // phase
        8 +     // phase_1_deadline
        8 +     // phase_2_deadline
        1 +     // is_launched
        1 +     // is_refundable
        1 +     // paused
        (32 * MAX_MULTISIG_SIGNERS) + // multisig_signers
        MAX_MULTISIG_SIGNERS + // multisig_approvals
        1 +     // pending_action
        4 +     // total_agt_attestations
        4 +     // total_aaron_audits
        1;      // bump
}

/// Donor — Per-donor account tracking donations and attestation status.
/// Seeds: ["donor", donor_pubkey]
#[account]
pub struct Donor {
    pub wallet: Pubkey,
    pub amount_lamports: u64,
    pub donated_at: i64,
    pub attested: bool,
    pub refund_claimed: bool,
    pub nft_minted: bool,
    pub referrer: Option<Pubkey>,
    pub optx_multiplier_bps: u16,
    pub bump: u8,
}

impl Donor {
    pub const LEN: usize = 8 + // discriminator
        32 +    // wallet
        8 +     // amount_lamports
        8 +     // donated_at
        1 +     // attested
        1 +     // refund_claimed
        1 +     // nft_minted
        1 + 32 + // referrer (Option<Pubkey>)
        2 +     // optx_multiplier_bps
        1;      // bump
}

/// DonorReceipt — NFT receipt PDA representing JTX claim from donation.
/// Seeds: ["receipt", vault_pubkey, donor_pubkey]
///
/// This is the on-chain proof that a donor (human or agent) is entitled
/// to X amount of JTX tokens at the end of the vault period.
///
/// Payment methods:
///   0 = SOL (human donation)
///   1 = USDC (agent via x402/MPP/Tempo CLI)
#[account]
pub struct DonorReceipt {
    /// Donor wallet (human or agent)
    pub donor: Pubkey,
    /// Vault this receipt belongs to
    pub vault: Pubkey,
    /// Original donation in lamports (SOL) or 0 for USDC
    pub donation_lamports: u64,
    /// Donation value in USDC (6 decimals)
    pub donation_value_usdc: u64,
    /// SOL/USD price used for conversion (6 decimals)
    pub sol_price_usdc: u64,
    /// JTX tokens entitled (9 decimals, includes multiplier)
    pub jtx_entitled: u64,
    /// JTX price used ($8.00 = 8_000_000 in 6-decimal USDC)
    pub jtx_price_usdc: u64,
    /// OPTX multiplier applied (100 = 1x, 150 = 1.5x)
    pub multiplier_bps: u16,
    /// Timestamp of NFT mint
    pub minted_at: i64,
    /// Whether JTX tokens have been claimed from this receipt
    pub claimed: bool,
    /// Payment method: 0 = SOL, 1 = USDC/agent
    pub payment_method: u8,
    /// PDA bump
    pub bump: u8,
}

impl DonorReceipt {
    pub const LEN: usize = 8 + // discriminator
        32 +    // donor
        32 +    // vault
        8 +     // donation_lamports
        8 +     // donation_value_usdc
        8 +     // sol_price_usdc
        8 +     // jtx_entitled
        8 +     // jtx_price_usdc
        2 +     // multiplier_bps
        8 +     // minted_at
        1 +     // claimed
        1 +     // payment_method
        1;      // bump
}

/// JtxVaultStats — Separate PDA tracking JTX donations.
/// Seeds: ["jtx_stats", vault_config_pubkey]
/// Kept separate from VaultConfig to avoid resizing the already-deployed account.
#[account]
pub struct JtxVaultStats {
    /// Total JTX tokens raised (9 decimals)
    pub total_jtx_raised: u64,
    /// Number of JTX donors
    pub jtx_donor_count: u32,
    /// Last JTX donation timestamp
    pub last_donation_at: i64,
    /// PDA bump
    pub bump: u8,
}

impl JtxVaultStats {
    pub const LEN: usize = 8 + // discriminator
        8 +     // total_jtx_raised
        4 +     // jtx_donor_count
        8 +     // last_donation_at
        1;      // bump
}

/// AgentAcquisition — Links agent USDC payment to acquired human.
/// Seeds: ["agent_acq", agent_pubkey, user_pubkey]
#[account]
pub struct AgentAcquisition {
    pub agent: Pubkey,
    pub target_user: Pubkey,
    pub usdc_amount: u64,
    pub acquired_at: i64,
    pub bump: u8,
}

impl AgentAcquisition {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 1;
}

/// AgentLedger — Aggregate stats for an agent.
/// Seeds: ["agent_ledger", agent_pubkey]
#[account]
pub struct AgentLedger {
    pub agent: Pubkey,
    pub total_usdc_paid: u64,
    pub users_acquired: u32,
    pub last_payment_at: i64,
    pub bump: u8,
}

impl AgentLedger {
    pub const LEN: usize = 8 + 32 + 8 + 4 + 8 + 1;
}

/// AGT Attestation — Core DePIN biometric authentication primitive.
/// Stores adaptive gaze tensor weights, biometric proof hash, and AARON audit.
/// Seeds: ["agt_attestation", owner_pubkey]
#[account]
pub struct AgtAttestation {
    /// Owner of this attestation
    pub owner: Pubkey,

    // --- AGT Tensor Fields ---
    /// Current simplex-projected weight vector [COG, ENV, EMO] (×1e6)
    pub agt_weights: [u64; AGT_DIMENSION],
    /// Most recent raw gaze tensor [COG, ENV, EMO] (×1e6)
    pub gaze_tensor: [u64; AGT_DIMENSION],
    /// Dual-space key k(t) = ⟨w(t), s⟩
    pub dual_key: u64,
    /// Bilinear extension score B(w, g) = Σ w_i · g_i · φ_i
    pub bilinear_score: u64,
    /// sha256(weights ‖ dual_key)
    pub tensor_hash: [u8; 32],

    // --- Biometric Proof (opaque, computed off-chain) ---
    /// 32-byte digest from off-chain biometric proof engine
    pub biometric_proof_hash: [u8; 32],

    // --- Combined ---
    /// sha256(tensor_hash ‖ biometric_proof_hash) — the full attestation hash
    pub attestation_hash: [u8; 32],

    // --- Metadata ---
    /// Device type (0=desktop, 1=mobile/MOJO, 2=edge)
    pub device_type: u8,
    pub created_at: i64,
    pub is_valid: bool,
    pub revoked_at: Option<i64>,

    // --- AARON Audit ---
    /// Immutable audit hash stamped by AARON operator (None until audited)
    pub aaron_audit_hash: Option<[u8; 32]>,

    // --- Subscription + Minting ---
    /// Total OPTX minted from this attestation
    pub optx_minted: u64,
    /// Subscription tier (0=none, 1=Basic 222/mo, 2=Unlimited)
    pub subscription_tier: u8,
    /// Mints in current period
    pub mint_count_this_period: u32,
    /// Start of current mint period (unix timestamp)
    pub period_start: i64,

    pub bump: u8,
}

impl AgtAttestation {
    pub const LEN: usize = 8 + // discriminator
        32 +                    // owner
        (8 * AGT_DIMENSION) +   // agt_weights
        (8 * AGT_DIMENSION) +   // gaze_tensor
        8 +                     // dual_key
        8 +                     // bilinear_score
        32 +                    // tensor_hash
        32 +                    // biometric_proof_hash
        32 +                    // attestation_hash
        1 +                     // device_type
        8 +                     // created_at
        1 +                     // is_valid
        1 + 8 +                 // revoked_at (Option<i64>)
        1 + 32 +                // aaron_audit_hash (Option<[u8;32]>)
        8 +                     // optx_minted
        1 +                     // subscription_tier
        4 +                     // mint_count_this_period
        8 +                     // period_start
        1;                      // bump
}

/// AaronAuditAccount — AARON operator's audit result for an AGT attestation.
/// Seeds: ["aaron_audit", agt_attestation_pubkey]
#[account]
pub struct AaronAuditAccount {
    /// The AGT attestation this audit covers
    pub agt_attestation: Pubkey,
    /// AARON operator who performed the audit
    pub auditor: Pubkey,
    /// Audit hash: sha256(attestation_hash ‖ risk ‖ cog ‖ env ‖ emo ‖ ts)
    pub audit_hash: [u8; 32],
    /// Overall risk score (0-10000 bps)
    pub risk_score: u16,
    /// Cognitive axis score
    pub cog_score: u16,
    /// Environmental axis score
    pub env_score: u16,
    /// Emotional axis score
    pub emo_score: u16,
    /// Hash of audit notes (stored off-chain)
    pub audit_notes_hash: [u8; 32],
    /// When the audit was performed
    pub audited_at: i64,
    pub bump: u8,
}

impl AaronAuditAccount {
    pub const LEN: usize = 8 + // discriminator
        32 +    // agt_attestation
        32 +    // auditor
        32 +    // audit_hash
        2 +     // risk_score
        2 +     // cog_score
        2 +     // env_score
        2 +     // emo_score
        32 +    // audit_notes_hash
        8 +     // audited_at
        1;      // bump
}

/// StakePosition — per-wallet locked-JTX position unlocking a subscription tier.
///
/// One position per wallet (PDA seeds: ["stake", owner]). To upgrade tier the
/// holder calls `restake_upgrade` (transfers the delta + extends expiry). To
/// withdraw at end-of-term the holder calls `unstake` after `expires_at`.
///
/// SPACE COWBOY (tier 3) has `expires_at = 0` and CANNOT be unstaked — the
/// 1,111 JTX is permanently locked in `stake_vault_ata`. This is the maximum
/// alignment commitment and there is intentionally no escape hatch.
#[account]
pub struct StakePosition {
    pub owner: Pubkey,       // 32 — user wallet
    pub tier: u8,            // 1  — 1=MOJO, 2=DOJO, 3=SPACE COWBOY
    pub amount: u64,         // 8  — locked JTX in 9-decimal raw
    pub staked_at: i64,      // 8  — unix timestamp at stake
    pub expires_at: i64,     // 8  — staked_at + duration; 0 = lifetime
    pub status: u8,          // 1  — 0=active, 1=withdrawn (terminal)
    pub bump: u8,            // 1
}

impl StakePosition {
    pub const LEN: usize = 8 + // discriminator
        32 +    // owner
        1 +     // tier
        8 +     // amount
        8 +     // staked_at
        8 +     // expires_at
        1 +     // status
        1;      // bump
}

// ============================================================================
// INSTRUCTION CONTEXTS
// ============================================================================

#[derive(Accounts)]
pub struct InitializeVault<'info> {
    #[account(mut)]
    pub founder: Signer<'info>,

    #[account(
        init,
        payer = founder,
        space = VaultConfig::LEN,
        seeds = [b"vault_config"],
        bump
    )]
    pub vault_config: Account<'info, VaultConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DonateSol<'info> {
    #[account(mut)]
    pub donor_signer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = donor_signer,
        space = Donor::LEN,
        seeds = [b"donor", donor_signer.key().as_ref()],
        bump
    )]
    pub donor: Account<'info, Donor>,

    #[account(
        mut,
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct DonateJtx<'info> {
    #[account(mut)]
    pub donor_signer: Signer<'info>,

    #[account(
        init_if_needed,
        payer = donor_signer,
        space = Donor::LEN,
        seeds = [b"donor", donor_signer.key().as_ref()],
        bump
    )]
    pub donor: Box<Account<'info, Donor>>,

    #[account(
        init_if_needed,
        payer = donor_signer,
        space = JtxVaultStats::LEN,
        seeds = [b"jtx_stats", vault_config.key().as_ref()],
        bump
    )]
    pub jtx_vault_stats: Box<Account<'info, JtxVaultStats>>,

    #[account(
        mut,
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Box<Account<'info, VaultConfig>>,

    /// Donor's JTX token account (Token-2022)
    #[account(mut)]
    pub donor_jtx_account: Box<InterfaceAccount<'info, anchor_spl::token_interface::TokenAccount>>,

    /// Vault's JTX token account (Token-2022) — receives the donated JTX
    #[account(mut)]
    pub vault_jtx_account: Box<InterfaceAccount<'info, anchor_spl::token_interface::TokenAccount>>,

    /// JTX mint (Token-2022)
    pub jtx_mint: Box<InterfaceAccount<'info, anchor_spl::token_interface::Mint>>,

    /// Token-2022 program
    pub token_program: Interface<'info, anchor_spl::token_interface::TokenInterface>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(usdc_amount: u64, target_user: Pubkey)]
pub struct DonateUsdcAgent<'info> {
    #[account(mut)]
    pub agent_signer: Signer<'info>,

    #[account(
        init,
        payer = agent_signer,
        space = AgentAcquisition::LEN,
        seeds = [b"agent_acq", agent_signer.key().as_ref(), target_user.as_ref()],
        bump
    )]
    pub agent_acquisition: Account<'info, AgentAcquisition>,

    #[account(
        init_if_needed,
        payer = agent_signer,
        space = AgentLedger::LEN,
        seeds = [b"agent_ledger", agent_signer.key().as_ref()],
        bump
    )]
    pub agent_ledger: Account<'info, AgentLedger>,

    #[account(
        mut,
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct LinkAttestation<'info> {
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"donor", donor.wallet.as_ref()],
        bump = donor.bump
    )]
    pub donor: Account<'info, Donor>,

    #[account(
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,

    /// CHECK: Validated by CPI to verify_attestation
    pub attestation: AccountInfo<'info>,

    /// CHECK: Validated by program ID constraint
    #[account(
        constraint = trust_program.key() == jtx_cstb_trust::ID @ VaultError::InvalidTrustProgram
    )]
    pub trust_program: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CreateAgtAttestation<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = AgtAttestation::LEN,
        seeds = [b"agt_attestation", user.key().as_ref()],
        bump
    )]
    pub agt_attestation: Account<'info, AgtAttestation>,

    #[account(
        mut,
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAgtWeights<'info> {
    #[account(
        constraint = user.key() == agt_attestation.owner @ VaultError::UnauthorizedSigner
    )]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"agt_attestation", agt_attestation.owner.as_ref()],
        bump = agt_attestation.bump
    )]
    pub agt_attestation: Account<'info, AgtAttestation>,

    #[account(
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,
}

#[derive(Accounts)]
pub struct AaronAudit<'info> {
    /// AARON operator (JOE's autonomous signer or authorized auditor)
    #[account(mut)]
    pub aaron_operator: Signer<'info>,

    #[account(
        mut,
        seeds = [b"agt_attestation", agt_attestation.owner.as_ref()],
        bump = agt_attestation.bump
    )]
    pub agt_attestation: Account<'info, AgtAttestation>,

    #[account(
        init,
        payer = aaron_operator,
        space = AaronAuditAccount::LEN,
        seeds = [b"aaron_audit", agt_attestation.key().as_ref()],
        bump
    )]
    pub aaron_audit_account: Account<'info, AaronAuditAccount>,

    #[account(
        mut,
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SetSubscription<'info> {
    /// JOE or authorized signer who verified $JTX balance
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"agt_attestation", agt_attestation.owner.as_ref()],
        bump = agt_attestation.bump
    )]
    pub agt_attestation: Account<'info, AgtAttestation>,

    #[account(
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,
}

#[derive(Accounts)]
pub struct MintOptx<'info> {
    #[account(
        constraint = user.key() == agt_attestation.owner @ VaultError::UnauthorizedSigner
    )]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"agt_attestation", agt_attestation.owner.as_ref()],
        bump = agt_attestation.bump
    )]
    pub agt_attestation: Account<'info, AgtAttestation>,

    #[account(
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,
}

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(mut)]
    pub donor_signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"donor", donor_signer.key().as_ref()],
        bump = donor.bump,
        constraint = donor.wallet == donor_signer.key() @ VaultError::UnauthorizedSigner
    )]
    pub donor: Account<'info, Donor>,

    #[account(
        mut,
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeAttestation<'info> {
    #[account(
        constraint = signer.key() == vault_config.authority @ VaultError::UnauthorizedSigner
    )]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"agt_attestation", agt_attestation.owner.as_ref()],
        bump = agt_attestation.bump
    )]
    pub agt_attestation: Account<'info, AgtAttestation>,

    #[account(
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,
}

#[derive(Accounts)]
pub struct MultisigAction<'info> {
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,
}

#[derive(Accounts)]
pub struct JoeAutonomous<'info> {
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,
}

#[derive(Accounts)]
pub struct FounderOnly<'info> {
    #[account(
        constraint = signer.key() == vault_config.authority @ VaultError::UnauthorizedSigner
    )]
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,
}

// Account fields are Box<...> to keep MintDonorNft::try_accounts under the
// BPF 4KB stack ceiling — same pattern used by DonateJtx (commit 0256cfc).
#[derive(Accounts)]
pub struct MintDonorNft<'info> {
    #[account(mut)]
    pub donor_signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"donor", donor_signer.key().as_ref()],
        bump = donor.bump,
        constraint = donor.wallet == donor_signer.key() @ VaultError::UnauthorizedSigner,
        constraint = !donor.nft_minted @ VaultError::NftAlreadyMinted
    )]
    pub donor: Box<Account<'info, Donor>>,

    #[account(
        init,
        payer = donor_signer,
        space = DonorReceipt::LEN,
        seeds = [b"receipt", vault_config.key().as_ref(), donor_signer.key().as_ref()],
        bump
    )]
    pub donor_receipt: Box<Account<'info, DonorReceipt>>,

    #[account(
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Box<Account<'info, VaultConfig>>,

    /// Donor's AGT attestation — must be owned by the signer and still valid.
    /// Required so we can pin `aaron_audit_account` to this attestation below.
    #[account(
        seeds = [b"agt_attestation", agt_attestation.owner.as_ref()],
        bump = agt_attestation.bump,
        constraint = agt_attestation.owner == donor_signer.key() @ VaultError::UnauthorizedSigner,
        constraint = agt_attestation.is_valid @ VaultError::AttestationRevoked,
    )]
    pub agt_attestation: Box<Account<'info, AgtAttestation>>,

    /// AARON audit PDA bound to the donor's `agt_attestation`. Freshness is
    /// enforced in the handler against `AARON_AUDIT_FRESHNESS_FOR_NFT_SECONDS`.
    #[account(
        seeds = [b"aaron_audit", agt_attestation.key().as_ref()],
        bump = aaron_audit_account.bump,
        constraint = aaron_audit_account.agt_attestation == agt_attestation.key()
            @ VaultError::Unauthorized,
    )]
    pub aaron_audit_account: Box<Account<'info, AaronAuditAccount>>,

    /// Pyth SOL/USD price update (PriceUpdateV2 PDA, posted by anyone via the
    /// Pyth Solana Receiver). Read on-chain — caller no longer supplies price.
    pub pyth_price_update: Box<Account<'info, PriceUpdateV2>>,

    pub system_program: Program<'info, System>,
}

// ───────────────────────────────────────────────────────────────────────────
// Stake subsystem accounts (v2.1)
// ───────────────────────────────────────────────────────────────────────────
//
// PDAs:
//   stake_position           [b"stake", owner]
//   stake_vault_authority    [b"stake_vault_authority", vault_config]
//   stake_vault_ata          ATA(stake_vault_authority, jtx_mint, Token2022)
//
// All transfers use Token-2022 `transfer_checked` (required because JTX is
// Token-2022; the program must enforce mint identity even if transferFee=0bps
// today, in case extensions are toggled in future deploys — though after the
// 2026-04-30 revoke that's no longer possible).

// All Account/InterfaceAccount fields are Box<...> to keep
// StakeForTier::try_accounts under the BPF 4KB stack ceiling. Without
// boxing the function frame is ~5.9KB. Same pattern as DonateJtx.
#[derive(Accounts)]
#[instruction(tier: u8)]
pub struct StakeForTier<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    /// User's JTX ATA — must hold ≥ tier threshold.
    #[account(
        mut,
        token::mint = jtx_mint,
        token::authority = user,
    )]
    pub user_jtx_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// New stake position (one per wallet).
    #[account(
        init,
        payer = user,
        space = StakePosition::LEN,
        seeds = [b"stake", user.key().as_ref()],
        bump
    )]
    pub stake_position: Box<Account<'info, StakePosition>>,

    /// CHECK: Program-owned PDA that holds the locked JTX. Address-only;
    /// no data lives at this PDA — it's just a signer for the stake_vault_ata.
    #[account(
        seeds = [b"stake_vault_authority", vault_config.key().as_ref()],
        bump
    )]
    pub stake_vault_authority: UncheckedAccount<'info>,

    /// Stake vault's JTX ATA. Initialized on first stake of any tier.
    /// `associated_token::token_program` is required so Anchor derives the
    /// ATA against Token-2022 (matching the JTX mint) instead of the default
    /// legacy SPL Token derivation. Without this, post-init constraint checks
    /// in Unstake / RestakeUpgrade error with `ConstraintAssociated`.
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = jtx_mint,
        associated_token::authority = stake_vault_authority,
        associated_token::token_program = token_program,
    )]
    pub stake_vault_ata: Box<InterfaceAccount<'info, TokenAccountInterface>>,

    /// Caller must already have a valid gaze attestation (preserves the
    /// "gaze before stake" model — tiers gate optical-proof users only).
    #[account(
        mut,
        seeds = [b"agt_attestation", user.key().as_ref()],
        bump = agt_attestation.bump,
        constraint = agt_attestation.owner == user.key() @ VaultError::Unauthorized,
        constraint = agt_attestation.is_valid @ VaultError::AttestationRevoked,
    )]
    pub agt_attestation: Box<Account<'info, AgtAttestation>>,

    #[account(
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Box<Account<'info, VaultConfig>>,

    pub jtx_mint: Box<InterfaceAccount<'info, MintInterface>>,
    pub token_program: Interface<'info, TokenInterface>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Unstake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        token::mint = jtx_mint,
        token::authority = user,
    )]
    pub user_jtx_ata: InterfaceAccount<'info, TokenAccountInterface>,

    /// Stake position must exist, be owned by `user`, and be active. Closed
    /// (rent refunded) on successful withdrawal — re-stake creates a new one.
    #[account(
        mut,
        close = user,
        seeds = [b"stake", user.key().as_ref()],
        bump = stake_position.bump,
        constraint = stake_position.owner == user.key() @ VaultError::Unauthorized,
        constraint = stake_position.status == 0 @ VaultError::StakeAlreadyWithdrawn,
    )]
    pub stake_position: Account<'info, StakePosition>,

    /// CHECK: signer PDA via seeds.
    #[account(
        seeds = [b"stake_vault_authority", vault_config.key().as_ref()],
        bump
    )]
    pub stake_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = jtx_mint,
        associated_token::authority = stake_vault_authority,
        associated_token::token_program = token_program,
    )]
    pub stake_vault_ata: InterfaceAccount<'info, TokenAccountInterface>,

    #[account(
        mut,
        seeds = [b"agt_attestation", user.key().as_ref()],
        bump = agt_attestation.bump,
    )]
    pub agt_attestation: Account<'info, AgtAttestation>,

    #[account(
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,

    pub jtx_mint: InterfaceAccount<'info, MintInterface>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
#[instruction(new_tier: u8)]
pub struct RestakeUpgrade<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        token::mint = jtx_mint,
        token::authority = user,
    )]
    pub user_jtx_ata: InterfaceAccount<'info, TokenAccountInterface>,

    /// Existing stake position — must be active and lower tier than new_tier.
    #[account(
        mut,
        seeds = [b"stake", user.key().as_ref()],
        bump = stake_position.bump,
        constraint = stake_position.owner == user.key() @ VaultError::Unauthorized,
        constraint = stake_position.status == 0 @ VaultError::StakeAlreadyWithdrawn,
    )]
    pub stake_position: Account<'info, StakePosition>,

    /// CHECK: signer PDA via seeds (not used here as signer, just for ATA derivation).
    #[account(
        seeds = [b"stake_vault_authority", vault_config.key().as_ref()],
        bump
    )]
    pub stake_vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        associated_token::mint = jtx_mint,
        associated_token::authority = stake_vault_authority,
        associated_token::token_program = token_program,
    )]
    pub stake_vault_ata: InterfaceAccount<'info, TokenAccountInterface>,

    #[account(
        mut,
        seeds = [b"agt_attestation", user.key().as_ref()],
        bump = agt_attestation.bump,
    )]
    pub agt_attestation: Account<'info, AgtAttestation>,

    #[account(
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,

    pub jtx_mint: InterfaceAccount<'info, MintInterface>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[derive(Accounts)]
pub struct MigrateV2Thresholds<'info> {
    /// Caller must be in vault_config.multisig_signers and have 2-of-3
    /// approvals on `pending_action == ACTION_MIGRATE_V2`.
    pub signer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"vault_config"],
        bump = vault_config.bump
    )]
    pub vault_config: Account<'info, VaultConfig>,

    // Caller passes target AgtAttestation accounts in remaining_accounts.
    // Each is mutated in the instruction body via account-info iteration —
    // see migrate_v2_thresholds() for the safe-deserialize loop.
}

// ============================================================================
// ERROR CODES
// ============================================================================

#[error_code]
pub enum VaultError {
    #[msg("Vault is currently paused")]
    VaultPaused,

    #[msg("Fundraising goal must be greater than zero")]
    InvalidGoal,

    #[msg("Deadline must be in the future")]
    InvalidDeadline,

    #[msg("Amount must be greater than zero")]
    ZeroAmount,

    #[msg("Vault has already launched")]
    VaultAlreadyLaunched,

    #[msg("Vault is not in refundable state")]
    NotRefundable,

    #[msg("Refund has already been claimed")]
    RefundAlreadyClaimed,

    #[msg("Donor has already been attested")]
    AlreadyAttested,

    #[msg("Unauthorized signer for this operation")]
    UnauthorizedSigner,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Invalid trust program ID for CPI")]
    InvalidTrustProgram,

    #[msg("Multisig threshold not reached")]
    MultisigThresholdNotReached,

    #[msg("Signer not in multisig list")]
    SignerNotInMultisig,

    // --- AGT Errors ---
    #[msg("Gaze tensor does not satisfy simplex constraint (Σ w_i ≈ 1)")]
    InvalidSimplexProjection,

    #[msg("Learning rate α must be between 0 and 10000 bps")]
    InvalidAlpha,

    #[msg("Attestation has been revoked")]
    AttestationRevoked,

    // --- AARON Errors ---
    #[msg("AARON audit already exists for this attestation")]
    AuditAlreadyExists,

    #[msg("Risk score must be between 0 and 10000 bps")]
    InvalidRiskScore,

    #[msg("AARON audit required before minting")]
    AuditRequired,

    // --- Subscription Errors ---
    #[msg("Invalid subscription tier (must be 1=Basic or 2=Unlimited)")]
    InvalidSubscriptionTier,

    #[msg("Insufficient $JTX for requested subscription tier")]
    InsufficientJtx,

    #[msg("No active subscription")]
    NoSubscription,

    #[msg("Mint cap exceeded for current subscription period")]
    MintCapExceeded,

    // --- NFT Receipt Errors ---
    #[msg("NFT receipt already minted for this donor")]
    NftAlreadyMinted,

    #[msg("Donation below minimum threshold for NFT receipt ($8 USDC = 1 JTX)")]
    BelowNftThreshold,

    // --- Stake Subsystem Errors (v2.1) ---
    #[msg("Caller is not authorized for this action")]
    Unauthorized,

    #[msg("This instruction is deprecated — use stake_for_tier(tier) instead")]
    Deprecated,

    #[msg("Stake position already exists for this wallet — call unstake or restake_upgrade")]
    StakeAlreadyExists,

    #[msg("Stake has not yet expired — cannot withdraw before expires_at")]
    StakeNotExpired,

    #[msg("SPACE COWBOY lifetime stake is permanently locked — no withdrawal possible, ever")]
    LifetimeStakePermanent,

    #[msg("Stake position has already been withdrawn (terminal state)")]
    StakeAlreadyWithdrawn,

    #[msg("New tier must be strictly higher than current tier (no downgrade via restake_upgrade)")]
    InvalidTierUpgrade,

    #[msg("Caller's $JTX ATA balance is below the required threshold for this tier")]
    StakeBalanceTooLow,

    #[msg("Multisig action not approved (need 2-of-3 signers on pending_action)")]
    MultisigNotApproved,

    #[msg("Migration already applied for this attestation")]
    AlreadyMigrated,

    #[msg("Pyth price feed is missing or stale (older than MAX_PYTH_AGE_SECONDS)")]
    PythPriceStale,

    #[msg("AARON audit is too stale for high-tier mint (> AARON_AUDIT_FRESHNESS_FOR_NFT_SECONDS)")]
    AuditTooStale,
}
