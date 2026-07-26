use anchor_lang::prelude::*;
use anchor_spl::token_2022::{self, MintTo, Token2022};
use anchor_spl::token_interface::{Mint, TokenAccount};

// Mainnet program ID (default / localnet).
// Devnet uses a separate ID via `--features devnet` so Phantom Blowfish can
// distinguish test transactions from mainnet ones.
#[cfg(not(feature = "devnet"))]
declare_id!("85sqs4upQiPrvk1NMuyfHVQoW1EGdgk8m2cQb7uMxXTF");

#[cfg(feature = "devnet")]
declare_id!("79nQsecDspUWxvAMyJvK36EUty4yEoP5ssLvHZuNiugF");

/// JTX OPTX Proof-of-Attention Trust Protocol v2.1.0
///
/// Combines JETT OPTICS gaze-based Proof-of-Attention with an opaque
/// compute-proof hash to create verified human-compute attestations on-chain.
/// Enables $JTX holders to mint $OPTX through verified identity attestations.
///
/// Naming: crate formerly `jtx_cstb_trust`. CompuStable / $CSTB is not a
/// product dependency. The on-chain `cstb_mint` account field is a legacy
/// layout slot (stored at initialize, unused for gating).
///
/// Internal review baseline: HEDGEHOG MCP (2026-01-30) — overflow protection,
/// double-mint prevention, replay protection. Third-party audit: pending.

#[program]
pub mod jtx_optx_devnet_poa_trustjoe {
    use super::*;

    /// Initialize the protocol with token mints and configuration
    pub fn initialize(
        ctx: Context<Initialize>,
        gaze_threshold: u64,
        compute_difficulty_min: u8,
        entropy_per_attestation: u64,
        optx_per_entropy: u64,
    ) -> Result<()> {
        let config = &mut ctx.accounts.protocol_config;

        config.authority = ctx.accounts.authority.key();
        config.jtx_mint = ctx.accounts.jtx_mint.key();
        config.cstb_mint = ctx.accounts.cstb_mint.key();
        config.optx_mint = ctx.accounts.optx_mint.key();
        config.total_handshakes = 0;
        config.total_attestations = 0;
        config.total_optx_minted = 0;
        config.gaze_threshold = gaze_threshold;
        config.compute_difficulty_min = compute_difficulty_min;
        config.entropy_per_attestation = entropy_per_attestation;
        config.optx_per_entropy = optx_per_entropy;
        config.paused = false; // [SECURITY FIX] Emergency pause capability
        config.bump = ctx.bumps.protocol_config;

        msg!("JTX OPTX PoA Trust Protocol v2.1.0 initialized");
        msg!("Authority: {}", config.authority);
        msg!("JTX Mint: {}", config.jtx_mint);
        msg!("Legacy compute mint slot: {}", config.cstb_mint);
        msg!("OPTX Mint: {}", config.optx_mint);
        msg!("Gaze threshold: {} centiseconds", gaze_threshold);
        msg!("Min compute difficulty: {}", compute_difficulty_min);

        Ok(())
    }

    /// Update protocol configuration (authority only)
    pub fn update_config(
        ctx: Context<UpdateConfig>,
        gaze_threshold: Option<u64>,
        compute_difficulty_min: Option<u8>,
        entropy_per_attestation: Option<u64>,
        optx_per_entropy: Option<u64>,
    ) -> Result<()> {
        let config = &mut ctx.accounts.protocol_config;

        if let Some(threshold) = gaze_threshold {
            config.gaze_threshold = threshold;
            msg!("Updated gaze threshold to: {}", threshold);
        }
        if let Some(difficulty) = compute_difficulty_min {
            config.compute_difficulty_min = difficulty;
            msg!("Updated min compute difficulty to: {}", difficulty);
        }
        if let Some(entropy) = entropy_per_attestation {
            config.entropy_per_attestation = entropy;
            msg!("Updated entropy per attestation to: {}", entropy);
        }
        if let Some(rate) = optx_per_entropy {
            config.optx_per_entropy = rate;
            msg!("Updated OPTX per entropy to: {}", rate);
        }

        Ok(())
    }

    /// [SECURITY FIX] Emergency pause/unpause protocol
    pub fn set_paused(ctx: Context<UpdateConfig>, paused: bool) -> Result<()> {
        let config = &mut ctx.accounts.protocol_config;
        config.paused = paused;
        msg!("Protocol paused status: {}", paused);
        Ok(())
    }

    /// Create a UserEntropy account for a new user
    pub fn create_user_entropy(ctx: Context<CreateUserEntropy>) -> Result<()> {
        let user_entropy = &mut ctx.accounts.user_entropy;

        user_entropy.owner = ctx.accounts.user.key();
        user_entropy.total_entropy = 0;
        user_entropy.entropy_used = 0;
        user_entropy.attestation_count = 0;
        user_entropy.last_attestation = 0;
        user_entropy.optx_minting_allowance = 0;
        user_entropy.bump = ctx.bumps.user_entropy;

        msg!("Created UserEntropy account for: {}", user_entropy.owner);

        Ok(())
    }

    /// Initiate a new handshake for attestation
    pub fn initiate_handshake(
        ctx: Context<InitiateHandshake>,
        handshake_id: [u8; 32],
    ) -> Result<()> {
        let handshake = &mut ctx.accounts.handshake;
        let config = &mut ctx.accounts.protocol_config;
        let clock = Clock::get()?;

        // [SECURITY FIX] Check protocol not paused
        require!(!config.paused, HandshakeError::ProtocolPaused);

        handshake.initiator = ctx.accounts.user.key();
        handshake.handshake_id = handshake_id;
        handshake.initiated_at = clock.unix_timestamp;
        handshake.expires_at = clock.unix_timestamp + 3600; // 1 hour expiry

        // Initialize gaze attestation fields
        handshake.gaze_verified = false;
        handshake.gaze_verified_at = 0;
        handshake.gaze_tensor_hash = [0u8; 32];
        handshake.cog_vector = [0i16; 3];
        handshake.emo_vector = [0i16; 3];
        handshake.env_vector = [0i16; 3];
        handshake.gaze_entropy = 0;

        // Initialize compute proof fields
        handshake.compute_verified = false;
        handshake.compute_verified_at = 0;
        handshake.compute_proof_hash = [0u8; 32];
        handshake.difficulty_level = 0;
        handshake.device_type = 0;
        handshake.proof_nonce = 0;
        handshake.compute_entropy = 0;

        handshake.attestation_complete = false;
        // [SECURITY FIX] Add finalized flag to prevent double-finalization
        handshake.finalized = false;
        // [SECURITY FIX] Add claimed flag for replay protection
        handshake.claimed = false;
        handshake.bump = ctx.bumps.handshake;

        // Increment global counter
        config.total_handshakes = config.total_handshakes.checked_add(1)
            .ok_or(HandshakeError::ArithmeticOverflow)?;

        msg!("Handshake initiated by: {}", handshake.initiator);
        msg!("Handshake ID: {:?}", handshake_id);
        msg!("Expires at: {}", handshake.expires_at);

        Ok(())
    }

    /// Submit gaze attestation data (AGT<>markov chain proof hash + vectors)
    pub fn submit_gaze_attestation(
        ctx: Context<SubmitGazeAttestation>,
        tensor_hash: [u8; 32],
        cog_vector: [i16; 3],
        emo_vector: [i16; 3],
        env_vector: [i16; 3],
        duration_cs: u64,
        gaze_entropy: u64,
    ) -> Result<()> {
        let handshake = &mut ctx.accounts.handshake;
        let config = &ctx.accounts.protocol_config;
        let clock = Clock::get()?;

        // [SECURITY FIX] Check protocol not paused
        require!(!config.paused, HandshakeError::ProtocolPaused);

        // Verify authorization
        require!(
            handshake.initiator == ctx.accounts.user.key(),
            HandshakeError::UnauthorizedSigner
        );

        // [SECURITY FIX] Check not already finalized
        require!(!handshake.finalized, HandshakeError::AlreadyFinalized);

        // Check expiry
        require!(
            clock.unix_timestamp < handshake.expires_at,
            HandshakeError::HandshakeExpired
        );

        // Verify gaze duration meets threshold (222 centiseconds = 2.22 seconds "jett capture")
        require!(
            duration_cs >= config.gaze_threshold,
            HandshakeError::InsufficientGazeDuration
        );

        // Validate entropy value
        require!(gaze_entropy > 0, HandshakeError::InvalidEntropy);

        // [SECURITY FIX] Cap entropy to prevent overflow attacks
        require!(gaze_entropy <= 1_000_000_000, HandshakeError::EntropyTooHigh);

        // Store gaze attestation data
        handshake.gaze_tensor_hash = tensor_hash;
        handshake.cog_vector = cog_vector;
        handshake.emo_vector = emo_vector;
        handshake.env_vector = env_vector;
        handshake.gaze_entropy = gaze_entropy;
        handshake.gaze_verified = true;
        handshake.gaze_verified_at = clock.unix_timestamp;

        msg!("AGT<>markov chain proof submitted");
        msg!("Tensor hash: {:?}", tensor_hash);
        msg!("COG vector: {:?}", cog_vector);
        msg!("EMO vector: {:?}", emo_vector);
        msg!("ENV vector: {:?}", env_vector);
        msg!("Duration: {} cs", duration_cs);
        msg!("Gaze entropy: {}", gaze_entropy);

        // Auto-finalize if compute already verified
        if handshake.compute_verified {
            handshake.attestation_complete = true;
            msg!("Attestation auto-finalized (compute was already verified)");
        }

        Ok(())
    }

    /// Submit opaque compute proof data (hash + difficulty).
    /// Not a CompuStable / $CSTB verification — caller-supplied hash attestation only.
    pub fn submit_compute_proof(
        ctx: Context<SubmitComputeProof>,
        proof_hash: [u8; 32],
        difficulty: u8,
        device_type: u8,
        nonce: u64,
        compute_entropy: u64,
    ) -> Result<()> {
        let handshake = &mut ctx.accounts.handshake;
        let config = &ctx.accounts.protocol_config;
        let clock = Clock::get()?;

        // [SECURITY FIX] Check protocol not paused
        require!(!config.paused, HandshakeError::ProtocolPaused);

        // Verify authorization
        require!(
            handshake.initiator == ctx.accounts.user.key(),
            HandshakeError::UnauthorizedSigner
        );

        // [SECURITY FIX] Check not already finalized
        require!(!handshake.finalized, HandshakeError::AlreadyFinalized);

        // Check expiry
        require!(
            clock.unix_timestamp < handshake.expires_at,
            HandshakeError::HandshakeExpired
        );

        // Verify difficulty meets minimum
        require!(
            difficulty >= config.compute_difficulty_min,
            HandshakeError::InsufficientDifficulty
        );

        // Validate entropy value
        require!(compute_entropy > 0, HandshakeError::InvalidEntropy);

        // [SECURITY FIX] Cap entropy to prevent overflow attacks
        require!(compute_entropy <= 1_000_000_000, HandshakeError::EntropyTooHigh);

        // Store compute proof data
        handshake.compute_proof_hash = proof_hash;
        handshake.difficulty_level = difficulty;
        handshake.device_type = device_type;
        handshake.proof_nonce = nonce;
        handshake.compute_entropy = compute_entropy;
        handshake.compute_verified = true;
        handshake.compute_verified_at = clock.unix_timestamp;

        msg!("Compute proof submitted");
        msg!("Proof hash: {:?}", proof_hash);
        msg!("Difficulty: {}", difficulty);
        msg!("Device type: {}", device_type);
        msg!("Nonce: {}", nonce);
        msg!("Compute entropy: {}", compute_entropy);

        // Auto-finalize if gaze already verified
        if handshake.gaze_verified {
            handshake.attestation_complete = true;
            msg!("Attestation auto-finalized (gaze was already verified)");
        }

        Ok(())
    }

    /// Finalize attestation and create permanent record
    pub fn finalize_attestation(ctx: Context<FinalizeAttestation>) -> Result<()> {
        let handshake = &mut ctx.accounts.handshake;
        let attestation = &mut ctx.accounts.attestation;
        let user_entropy = &mut ctx.accounts.user_entropy;
        let config = &mut ctx.accounts.protocol_config;
        let clock = Clock::get()?;

        // [SECURITY FIX] Check protocol not paused
        require!(!config.paused, HandshakeError::ProtocolPaused);

        // [SECURITY FIX] Check not already finalized (prevents double-finalization)
        require!(!handshake.finalized, HandshakeError::AlreadyFinalized);

        // [SECURITY FIX] Check not already claimed (prevents replay)
        require!(!handshake.claimed, HandshakeError::AlreadyClaimed);

        // [SECURITY FIX] Re-check expiry in finalize
        require!(
            clock.unix_timestamp < handshake.expires_at,
            HandshakeError::HandshakeExpired
        );

        // Verify both proofs are complete
        require!(
            handshake.gaze_verified && handshake.compute_verified,
            HandshakeError::IncompleteAttestation
        );

        // Calculate combined entropy
        let combined_entropy = handshake.gaze_entropy
            .checked_add(handshake.compute_entropy)
            .ok_or(HandshakeError::ArithmeticOverflow)?;

        // Create combined hash (gaze_hash || compute_hash)
        let mut combined_hash = [0u8; 64];
        combined_hash[..32].copy_from_slice(&handshake.gaze_tensor_hash);
        combined_hash[32..].copy_from_slice(&handshake.compute_proof_hash);

        // [SECURITY FIX] Calculate OPTX allowance using u128 intermediate to prevent overflow
        // Formula: (gaze_entropy + compute_entropy) * difficulty * optx_per_entropy / 1000
        let difficulty_multiplier = handshake.difficulty_level as u128;
        let optx_allowance_u128 = (combined_entropy as u128)
            .checked_mul(difficulty_multiplier)
            .ok_or(HandshakeError::ArithmeticOverflow)?
            .checked_mul(config.optx_per_entropy as u128)
            .ok_or(HandshakeError::ArithmeticOverflow)?
            .checked_div(1000)
            .ok_or(HandshakeError::ArithmeticOverflow)?;

        // [SECURITY FIX] Ensure result fits in u64
        let optx_allowance: u64 = optx_allowance_u128
            .try_into()
            .map_err(|_| HandshakeError::ArithmeticOverflow)?;

        // Populate attestation account
        attestation.owner = ctx.accounts.user.key();
        attestation.handshake_id = handshake.handshake_id;
        attestation.created_at = clock.unix_timestamp;
        attestation.gaze_tensor_hash = handshake.gaze_tensor_hash;
        attestation.compute_proof_hash = handshake.compute_proof_hash;
        attestation.combined_hash = combined_hash;
        attestation.combined_entropy = combined_entropy;
        attestation.optx_minted = 0; // Will be updated when user mints
        attestation.difficulty_level = handshake.difficulty_level;
        attestation.device_type = handshake.device_type;
        attestation.is_valid = true;
        attestation.revoked_at = None;
        attestation.bump = ctx.bumps.attestation;

        // Update user entropy account
        user_entropy.total_entropy = user_entropy.total_entropy
            .checked_add(combined_entropy)
            .ok_or(HandshakeError::ArithmeticOverflow)?;
        user_entropy.attestation_count = user_entropy.attestation_count
            .checked_add(1)
            .ok_or(HandshakeError::ArithmeticOverflow)?;
        user_entropy.last_attestation = clock.unix_timestamp;
        user_entropy.optx_minting_allowance = user_entropy.optx_minting_allowance
            .checked_add(optx_allowance)
            .ok_or(HandshakeError::ArithmeticOverflow)?;

        // Update protocol config
        config.total_attestations = config.total_attestations
            .checked_add(1)
            .ok_or(HandshakeError::ArithmeticOverflow)?;

        // [SECURITY FIX] Mark handshake as finalized and claimed
        handshake.finalized = true;
        handshake.claimed = true;

        msg!("Attestation finalized");
        msg!("Owner: {}", attestation.owner);
        msg!("Combined entropy: {}", combined_entropy);
        msg!("OPTX allowance earned: {}", optx_allowance);
        msg!("Total user entropy: {}", user_entropy.total_entropy);
        msg!("Total user OPTX allowance: {}", user_entropy.optx_minting_allowance);
        msg!("Protocol total attestations: {}", config.total_attestations);

        Ok(())
    }

    /// Mint OPTX tokens based on accumulated entropy allowance
    pub fn mint_optx(ctx: Context<MintOptx>, amount: u64) -> Result<()> {
        // [SECURITY FIX] Check protocol not paused
        require!(!ctx.accounts.protocol_config.paused, HandshakeError::ProtocolPaused);

        // Verify authorization
        require!(
            ctx.accounts.user_entropy.owner == ctx.accounts.user.key(),
            HandshakeError::UnauthorizedSigner
        );

        // Verify sufficient allowance
        require!(
            amount <= ctx.accounts.user_entropy.optx_minting_allowance,
            HandshakeError::InsufficientAllowance
        );

        // [SECURITY FIX] Deduct allowance BEFORE CPI to prevent double-mint race
        let user_entropy = &mut ctx.accounts.user_entropy;
        user_entropy.optx_minting_allowance = user_entropy.optx_minting_allowance
            .checked_sub(amount)
            .ok_or(HandshakeError::ArithmeticOverflow)?;

        // Get bump for signing
        let bump = ctx.accounts.protocol_config.bump;

        // Mint OPTX tokens via CPI
        let seeds = &[
            b"protocol-config".as_ref(),
            &[bump],
        ];
        let signer_seeds = &[&seeds[..]];

        let cpi_accounts = MintTo {
            mint: ctx.accounts.optx_mint.to_account_info(),
            to: ctx.accounts.user_optx_account.to_account_info(),
            authority: ctx.accounts.protocol_config.to_account_info(),
        };
        let cpi_program = ctx.accounts.token_program.to_account_info();
        let cpi_ctx = CpiContext::new_with_signer(cpi_program, cpi_accounts, signer_seeds);

        token_2022::mint_to(cpi_ctx, amount)?;

        // Update entropy used tracking
        user_entropy.entropy_used = user_entropy.entropy_used
            .checked_add(amount)
            .ok_or(HandshakeError::ArithmeticOverflow)?;

        // Update protocol stats
        let config = &mut ctx.accounts.protocol_config;
        config.total_optx_minted = config.total_optx_minted
            .checked_add(amount)
            .ok_or(HandshakeError::ArithmeticOverflow)?;

        msg!("Minted {} OPTX to user", amount);
        msg!("Remaining allowance: {}", user_entropy.optx_minting_allowance);
        msg!("Total OPTX minted by protocol: {}", config.total_optx_minted);

        Ok(())
    }

    /// Verify if an attestation exists and is valid (read-only utility)
    pub fn verify_attestation(ctx: Context<VerifyAttestation>) -> Result<bool> {
        let attestation = &ctx.accounts.attestation;

        let is_valid = attestation.is_valid && attestation.revoked_at.is_none();

        msg!("Attestation verification for owner: {}", attestation.owner);
        msg!("Is valid: {}", is_valid);

        Ok(is_valid)
    }

    /// Revoke an attestation (owner or authority only)
    pub fn revoke_attestation(ctx: Context<RevokeAttestation>) -> Result<()> {
        let attestation = &mut ctx.accounts.attestation;
        let clock = Clock::get()?;

        // Verify already not revoked
        require!(attestation.is_valid, HandshakeError::AlreadyRevoked);

        attestation.is_valid = false;
        attestation.revoked_at = Some(clock.unix_timestamp);

        msg!("Attestation revoked");
        msg!("Owner: {}", attestation.owner);
        msg!("Revoked at: {}", clock.unix_timestamp);

        Ok(())
    }

    /// Close a handshake account and reclaim rent (after expiry or completion)
    pub fn close_handshake(ctx: Context<CloseHandshake>) -> Result<()> {
        let handshake = &ctx.accounts.handshake;
        let clock = Clock::get()?;

        // Can only close if expired or attestation complete
        require!(
            clock.unix_timestamp >= handshake.expires_at || handshake.attestation_complete,
            HandshakeError::CannotCloseActiveHandshake
        );

        msg!("Handshake account closed");
        msg!("Initiator: {}", handshake.initiator);

        Ok(())
    }
}

// ============================================================================
// ACCOUNT STRUCTURES
// ============================================================================

/// Global protocol configuration
#[account]
pub struct ProtocolConfig {
    /// Authority who can update config
    pub authority: Pubkey,
    /// $JTX token mint address (mainnet v2: JTXGnx83s2QZ2MwYkRD1cBKrqQKSdG5oe8vSYW5Zjoe)
    pub jtx_mint: Pubkey,
    /// Legacy layout field (historically named cstb_mint). Stored at initialize;
    /// unused for gating. Not a CompuStable product mint.
    pub cstb_mint: Pubkey,
    /// $OPTX token mint address (Token-2022)
    pub optx_mint: Pubkey,
    /// Total handshakes initiated
    pub total_handshakes: u64,
    /// Total attestations completed
    pub total_attestations: u64,
    /// Total $OPTX minted via the protocol
    pub total_optx_minted: u64,
    /// Minimum gaze duration in centiseconds (default: 222 = 2.22s)
    pub gaze_threshold: u64,
    /// Minimum compute difficulty level (1 = Easy)
    pub compute_difficulty_min: u8,
    /// Base entropy earned per attestation
    pub entropy_per_attestation: u64,
    /// OPTX tokens per entropy unit (multiplied by 1000)
    pub optx_per_entropy: u64,
    /// [SECURITY FIX] Emergency pause flag
    pub paused: bool,
    /// PDA bump seed
    pub bump: u8,
}

impl ProtocolConfig {
    pub const LEN: usize = 8 + // discriminator
        32 +    // authority
        32 +    // jtx_mint
        32 +    // cstb_mint
        32 +    // optx_mint
        8 +     // total_handshakes
        8 +     // total_attestations
        8 +     // total_optx_minted
        8 +     // gaze_threshold
        1 +     // compute_difficulty_min
        8 +     // entropy_per_attestation
        8 +     // optx_per_entropy
        1 +     // paused [SECURITY FIX]
        1;      // bump
}

/// Individual handshake tracking state
#[account]
pub struct Handshake {
    /// User who initiated the handshake
    pub initiator: Pubkey,
    /// Unique handshake identifier
    pub handshake_id: [u8; 32],
    /// Timestamp when handshake was initiated
    pub initiated_at: i64,
    /// Timestamp when handshake expires
    pub expires_at: i64,

    // === Gaze Attestation (AGT<>markov chain proofs) ===
    /// Whether gaze has been verified
    pub gaze_verified: bool,
    /// Timestamp when gaze was verified
    pub gaze_verified_at: i64,
    /// SHA-256 hash of the AGT tensor
    pub gaze_tensor_hash: [u8; 32],
    /// Cognitive vector (visual search, decision-making, focus)
    pub cog_vector: [i16; 3],
    /// Emotional vector (saccade variations from emotional state)
    pub emo_vector: [i16; 3],
    /// Environmental vector (lighting, device, context)
    pub env_vector: [i16; 3],
    /// Entropy generated from gaze patterns
    pub gaze_entropy: u64,

    // === Compute Proof ===
    /// Whether compute proof has been verified
    pub compute_verified: bool,
    /// Timestamp when compute was verified
    pub compute_verified_at: i64,
    /// SHA-256 hash of the compute proof
    pub compute_proof_hash: [u8; 32],
    /// Difficulty level (1=Easy, 2=Medium, 3=Hard, etc.)
    pub difficulty_level: u8,
    /// Device type (0=Unknown, 1=Mobile, 2=Laptop, 3=Desktop, 4=Server)
    pub device_type: u8,
    /// Proof nonce for verification
    pub proof_nonce: u64,
    /// Entropy generated from compute proof
    pub compute_entropy: u64,

    /// Whether the attestation is complete
    pub attestation_complete: bool,
    /// [SECURITY FIX] Whether this handshake has been finalized (prevents double-finalization)
    pub finalized: bool,
    /// [SECURITY FIX] Whether this handshake has been claimed (prevents replay attacks)
    pub claimed: bool,
    /// PDA bump seed
    pub bump: u8,
}

impl Handshake {
    pub const LEN: usize = 8 + // discriminator
        32 +    // initiator
        32 +    // handshake_id
        8 +     // initiated_at
        8 +     // expires_at
        // Gaze attestation
        1 +     // gaze_verified
        8 +     // gaze_verified_at
        32 +    // gaze_tensor_hash
        6 +     // cog_vector (3 * i16)
        6 +     // emo_vector (3 * i16)
        6 +     // env_vector (3 * i16)
        8 +     // gaze_entropy
        // Compute proof
        1 +     // compute_verified
        8 +     // compute_verified_at
        32 +    // compute_proof_hash
        1 +     // difficulty_level
        1 +     // device_type
        8 +     // proof_nonce
        8 +     // compute_entropy
        // Status
        1 +     // attestation_complete
        1 +     // finalized [SECURITY FIX]
        1 +     // claimed [SECURITY FIX]
        1;      // bump
}

/// Permanent attestation record
#[account]
pub struct Attestation {
    /// Owner of the attestation
    pub owner: Pubkey,
    /// Handshake ID that created this attestation
    pub handshake_id: [u8; 32],
    /// Timestamp when attestation was created
    pub created_at: i64,
    /// AGT<>markov chain proof tensor hash
    pub gaze_tensor_hash: [u8; 32],
    /// Compute proof hash
    pub compute_proof_hash: [u8; 32],
    /// Combined hash (gaze || compute) for external verification
    pub combined_hash: [u8; 64],
    /// Combined entropy from both proofs
    pub combined_entropy: u64,
    /// Amount of $OPTX minted from this attestation
    pub optx_minted: u64,
    /// Difficulty level of the compute proof
    pub difficulty_level: u8,
    /// Device type used for compute
    pub device_type: u8,
    /// Whether the attestation is currently valid
    pub is_valid: bool,
    /// Timestamp when attestation was revoked (if applicable)
    pub revoked_at: Option<i64>,
    /// PDA bump seed
    pub bump: u8,
}

impl Attestation {
    pub const LEN: usize = 8 + // discriminator
        32 +    // owner
        32 +    // handshake_id
        8 +     // created_at
        32 +    // gaze_tensor_hash
        32 +    // compute_proof_hash
        64 +    // combined_hash
        8 +     // combined_entropy
        8 +     // optx_minted
        1 +     // difficulty_level
        1 +     // device_type
        1 +     // is_valid
        9 +     // revoked_at (Option<i64> = 1 + 8)
        1;      // bump
}

/// User entropy tracking for OPTX minting
#[account]
pub struct UserEntropy {
    /// Owner of this entropy account
    pub owner: Pubkey,
    /// Total entropy accumulated
    pub total_entropy: u64,
    /// Entropy already used for minting
    pub entropy_used: u64,
    /// Number of attestations completed
    pub attestation_count: u64,
    /// Timestamp of last attestation
    pub last_attestation: i64,
    /// Current OPTX minting allowance
    pub optx_minting_allowance: u64,
    /// PDA bump seed
    pub bump: u8,
}

impl UserEntropy {
    pub const LEN: usize = 8 + // discriminator
        32 +    // owner
        8 +     // total_entropy
        8 +     // entropy_used
        8 +     // attestation_count
        8 +     // last_attestation
        8 +     // optx_minting_allowance
        1;      // bump
}

// ============================================================================
// INSTRUCTION CONTEXTS
// ============================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer = authority,
        space = ProtocolConfig::LEN,
        seeds = [b"protocol-config"],
        bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    /// CHECK: JTX mint address, validated by authority
    pub jtx_mint: UncheckedAccount<'info>,

    /// CHECK: Legacy compute-mint layout slot; authority-supplied at initialize, unused for gating.
    pub cstb_mint: UncheckedAccount<'info>,

    /// OPTX mint (Token-2022)
    #[account(
        constraint = optx_mint.mint_authority.contains(&protocol_config.key()) @ HandshakeError::InvalidMintAuthority
    )]
    pub optx_mint: InterfaceAccount<'info, Mint>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateConfig<'info> {
    #[account(
        constraint = authority.key() == protocol_config.authority @ HandshakeError::UnauthorizedSigner
    )]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"protocol-config"],
        bump = protocol_config.bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

#[derive(Accounts)]
pub struct CreateUserEntropy<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = UserEntropy::LEN,
        seeds = [b"user-entropy", user.key().as_ref()],
        bump
    )]
    pub user_entropy: Account<'info, UserEntropy>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(handshake_id: [u8; 32])]
pub struct InitiateHandshake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = Handshake::LEN,
        seeds = [b"handshake", user.key().as_ref(), handshake_id.as_ref()],
        bump
    )]
    pub handshake: Account<'info, Handshake>,

    #[account(
        mut,
        seeds = [b"protocol-config"],
        bump = protocol_config.bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct SubmitGazeAttestation<'info> {
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"handshake", handshake.initiator.as_ref(), handshake.handshake_id.as_ref()],
        bump = handshake.bump
    )]
    pub handshake: Account<'info, Handshake>,

    #[account(
        seeds = [b"protocol-config"],
        bump = protocol_config.bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

#[derive(Accounts)]
pub struct SubmitComputeProof<'info> {
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"handshake", handshake.initiator.as_ref(), handshake.handshake_id.as_ref()],
        bump = handshake.bump
    )]
    pub handshake: Account<'info, Handshake>,

    #[account(
        seeds = [b"protocol-config"],
        bump = protocol_config.bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

#[derive(Accounts)]
pub struct FinalizeAttestation<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut, // [SECURITY FIX] Changed to mut to update finalized/claimed flags
        seeds = [b"handshake", handshake.initiator.as_ref(), handshake.handshake_id.as_ref()],
        bump = handshake.bump,
        constraint = handshake.initiator == user.key() @ HandshakeError::UnauthorizedSigner
    )]
    pub handshake: Account<'info, Handshake>,

    #[account(
        init,
        payer = user,
        space = Attestation::LEN,
        seeds = [b"attestation", user.key().as_ref(), handshake.handshake_id.as_ref()],
        bump
    )]
    pub attestation: Account<'info, Attestation>,

    #[account(
        mut,
        seeds = [b"user-entropy", user.key().as_ref()],
        bump = user_entropy.bump,
        constraint = user_entropy.owner == user.key() @ HandshakeError::UnauthorizedSigner
    )]
    pub user_entropy: Account<'info, UserEntropy>,

    #[account(
        mut,
        seeds = [b"protocol-config"],
        bump = protocol_config.bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct MintOptx<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"user-entropy", user.key().as_ref()],
        bump = user_entropy.bump
    )]
    pub user_entropy: Account<'info, UserEntropy>,

    #[account(
        mut,
        seeds = [b"protocol-config"],
        bump = protocol_config.bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,

    #[account(
        mut,
        constraint = optx_mint.key() == protocol_config.optx_mint @ HandshakeError::InvalidMint
    )]
    pub optx_mint: InterfaceAccount<'info, Mint>,

    #[account(
        mut,
        constraint = user_optx_account.owner == user.key() @ HandshakeError::UnauthorizedSigner,
        constraint = user_optx_account.mint == optx_mint.key() @ HandshakeError::InvalidMint
    )]
    pub user_optx_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program: Program<'info, Token2022>,
}

#[derive(Accounts)]
pub struct VerifyAttestation<'info> {
    #[account(
        seeds = [b"attestation", attestation.owner.as_ref(), attestation.handshake_id.as_ref()],
        bump = attestation.bump
    )]
    pub attestation: Account<'info, Attestation>,
}

#[derive(Accounts)]
pub struct RevokeAttestation<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [b"attestation", attestation.owner.as_ref(), attestation.handshake_id.as_ref()],
        bump = attestation.bump,
        constraint = authority.key() == attestation.owner ||
                     authority.key() == protocol_config.authority @ HandshakeError::UnauthorizedSigner
    )]
    pub attestation: Account<'info, Attestation>,

    #[account(
        seeds = [b"protocol-config"],
        bump = protocol_config.bump
    )]
    pub protocol_config: Account<'info, ProtocolConfig>,
}

#[derive(Accounts)]
pub struct CloseHandshake<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [b"handshake", handshake.initiator.as_ref(), handshake.handshake_id.as_ref()],
        bump = handshake.bump,
        constraint = handshake.initiator == user.key() @ HandshakeError::UnauthorizedSigner,
        close = user
    )]
    pub handshake: Account<'info, Handshake>,
}

// ============================================================================
// ERROR CODES
// ============================================================================

#[error_code]
pub enum HandshakeError {
    #[msg("Handshake has expired")]
    HandshakeExpired,

    #[msg("Gaze duration below threshold (minimum 222 centiseconds / 2.22 seconds)")]
    InsufficientGazeDuration,

    #[msg("Compute difficulty too low")]
    InsufficientDifficulty,

    #[msg("Both gaze and compute attestations must be verified before finalizing")]
    IncompleteAttestation,

    #[msg("Unauthorized signer")]
    UnauthorizedSigner,

    #[msg("Attestation has already been finalized")]
    AlreadyFinalized,

    #[msg("Attestation has already been revoked")]
    AlreadyRevoked,

    #[msg("Insufficient OPTX minting allowance")]
    InsufficientAllowance,

    #[msg("Invalid entropy value (must be > 0)")]
    InvalidEntropy,

    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,

    #[msg("Invalid mint address")]
    InvalidMint,

    #[msg("Invalid mint authority")]
    InvalidMintAuthority,

    #[msg("Cannot close active handshake (must be expired or complete)")]
    CannotCloseActiveHandshake,

    // [SECURITY FIX] New error codes
    #[msg("Protocol is currently paused")]
    ProtocolPaused,

    #[msg("Handshake has already been claimed")]
    AlreadyClaimed,

    #[msg("Entropy value exceeds maximum allowed (1 billion)")]
    EntropyTooHigh,
}
