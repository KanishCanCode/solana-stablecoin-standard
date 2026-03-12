//! Account definitions and error codes for the stablecoin core program.
//!
//! Three account types:
//! - [`IssuanceConfig`]   — root config, one per mint
//! - [`MinterAllowance`]  — per-minter quota tracking
//! - [`MintProposal`]     — SSS-3 multi-sig pending mint

use anchor_lang::prelude::*;
use sss_events::Tier;

// ---------------------------------------------------------------------------
// Timelock / limits
// ---------------------------------------------------------------------------

/// 24-hour authority handover timelock (SSS-3).
pub const HANDOVER_LOCK_SECS: i64 = 86_400;

/// Hard cap on multi-sig co-signers.
pub const MAX_CO_SIGNERS: usize = 5;

// ---------------------------------------------------------------------------
// Role index constants  (0-indexed, passed in AssignRoleParams)
// ---------------------------------------------------------------------------

pub const ROLE_ISSUER:      u8 = 0;  // manages minter allowances
pub const ROLE_GUARDIAN:    u8 = 1;  // halt / resume
pub const ROLE_COMPLIANCE:  u8 = 2;  // denylist + confiscate

// ---------------------------------------------------------------------------
// IssuanceConfig
// ---------------------------------------------------------------------------

/// Root configuration for a stablecoin deployment.
///
/// PDA: `[b"stbl_config", mint]`
#[account]
pub struct IssuanceConfig {
    // -- Identity ---------------------------------------------------------
    pub mint:      Pubkey,
    pub authority: Pubkey,

    // -- Pending two-step authority handover ------------------------------
    pub pending_authority:    Pubkey,
    pub authority_unlock_ts:  i64,   // 0 = no active timelock

    // -- Operational roles ------------------------------------------------
    pub issuer:     Pubkey,    // role index 0 — manages minter allowances
    pub guardian:   Pubkey,    // role index 1 — pause/unpause
    pub compliance: Pubkey,    // role index 2 — blacklist + seize

    // -- Tier configuration -----------------------------------------------
    pub tier:    Tier,
    pub halted:  bool,    // true = all ops suspended

    // -- Audit counters (monotonically increasing) -------------------------
    pub total_issued:  u64,
    pub total_burned:  u64,
    pub total_seized:  u64,
    pub event_seq:     u64,

    // -- SSS-3 rate window ------------------------------------------------
    pub window_secs:       u64,
    pub window_cap:        u64,
    pub window_issued:     u64,
    pub window_opened_ts:  i64,

    // -- SSS-3 co-sign gate -----------------------------------------------
    pub cosign_threshold: u8,
    pub cosigners:        [Pubkey; 5],
    pub next_proposal:    u64,

    // -- PDA metadata -----------------------------------------------------
    pub bump: u8,
}

impl IssuanceConfig {
    /// Packed byte length (discriminator included).
    pub const LEN: usize = 8
        + 32  // mint
        + 32  // authority
        + 32  // pending_authority
        + 8   // authority_unlock_ts
        + 32  // issuer
        + 32  // guardian
        + 32  // compliance
        + 1   // tier
        + 1   // halted
        + 8   // total_issued
        + 8   // total_burned
        + 8   // total_seized
        + 8   // event_seq
        + 8   // window_secs
        + 8   // window_cap
        + 8   // window_issued
        + 8   // window_opened_ts
        + 1   // cosign_threshold
        + 160 // cosigners (5 × 32)
        + 8   // next_proposal
        + 1;  // bump

    /// Increment the event sequence counter and return the new value.
    #[inline]
    pub fn advance_seq(&mut self) -> u64 {
        self.event_seq = self.event_seq.saturating_add(1);
        self.event_seq
    }

    /// Returns true if `amount` tokens can be minted within the current window.
    pub fn window_allows(&self, amount: u64, now: i64) -> Result<()> {
        if self.window_secs == 0 {
            return Ok(());
        }
        let elapsed = now.saturating_sub(self.window_opened_ts) as u64;
        let already_issued = if elapsed >= self.window_secs { 0u64 } else { self.window_issued };

        let projected = already_issued
            .checked_add(amount)
            .ok_or(error!(StablecoinError::Overflow))?;

        require!(projected <= self.window_cap, StablecoinError::WindowCapExceeded);
        Ok(())
    }

    /// Record a mint against the rolling window (call after `window_allows`).
    pub fn record_window_mint(&mut self, amount: u64, now: i64) -> Result<()> {
        if self.window_secs == 0 {
            return Ok(());
        }
        let elapsed = now.saturating_sub(self.window_opened_ts) as u64;
        if elapsed >= self.window_secs {
            self.window_opened_ts = now;
            self.window_issued    = amount;
        } else {
            self.window_issued = self
                .window_issued
                .checked_add(amount)
                .ok_or(error!(StablecoinError::Overflow))?;
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// MinterAllowance
// ---------------------------------------------------------------------------

/// Minter quota account.
///
/// PDA: `[b"stbl_minter", mint, minter_wallet]`
#[account]
pub struct MinterAllowance {
    pub mint:         Pubkey,
    pub wallet:       Pubkey,
    pub cap:          u64,    // maximum lifetime tokens
    pub issued:       u64,    // tokens minted so far (burn does not restore)
    pub enabled:      bool,
    pub bump:         u8,
}

impl MinterAllowance {
    pub const LEN: usize = 8 + 32 + 32 + 8 + 8 + 1 + 1;

    /// Remaining unused allowance.
    #[inline]
    pub fn headroom(&self) -> u64 {
        self.cap.saturating_sub(self.issued)
    }
}

// ---------------------------------------------------------------------------
// MintProposal  (SSS-3 only)
// ---------------------------------------------------------------------------

/// A queued multi-sig mint request.
///
/// PDA: `[b"stbl_proposal", mint, proposal_id_le8]`
#[account]
pub struct MintProposal {
    pub mint:        Pubkey,
    pub seq:         u64,
    pub proposer:    Pubkey,
    pub recipient:   Pubkey,
    pub amount:      u64,
    pub vote_count:  u8,
    pub vote_mask:   u8,    // bitmask — bit i = cosigners[i] has voted
    pub executed:    bool,
    pub expires_ts:  i64,
    pub bump:        u8,
}

impl MintProposal {
    pub const LEN: usize = 8 + 32 + 8 + 32 + 32 + 8 + 1 + 1 + 1 + 8 + 1;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

#[error_code]
pub enum StablecoinError {
    // --- Access control ---
    #[msg("Signer is not the program authority")]
    AuthorityRequired,
    #[msg("Signer must hold the issuer role")]
    IssuerRoleRequired,
    #[msg("Signer must hold the guardian role")]
    GuardianRoleRequired,
    #[msg("Signer must hold the compliance role")]
    ComplianceRoleRequired,
    #[msg("Signer is not the pending authority")]
    PendingAuthorityRequired,

    // --- Operational state ---
    #[msg("Operations are suspended — contract is halted")]
    Halted,
    #[msg("Minter allowance is disabled")]
    AllowanceDisabled,
    #[msg("Minter allowance cap would be exceeded")]
    AllowanceCapExceeded,
    #[msg("Authority handover has no pending transfer")]
    NoPendingHandover,
    #[msg("Authority handover timelock has not cleared")]
    HandoverLocked,

    // --- Input validation ---
    #[msg("Zero address is not permitted")]
    ZeroAddress,
    #[msg("Amount must be non-zero")]
    ZeroAmount,
    #[msg("Arithmetic overflow")]
    Overflow,
    #[msg("Operation requires a higher feature tier")]
    TierInsufficient,
    #[msg("Compliance hook program must be provided for Tier-2/3")]
    HookRequired,

    // --- SSS-3 window ---
    #[msg("Mint would exceed the rolling-window cap")]
    WindowCapExceeded,

    // --- SSS-3 proposals ---
    #[msg("Proposal has passed its expiry time")]
    ProposalExpired,
    #[msg("Proposal was already executed")]
    ProposalConsumed,
    #[msg("This co-signer already voted on the proposal")]
    DuplicateVote,
    #[msg("Signer is not a registered co-signer for this mint")]
    UnrecognisedCosigner,
    #[msg("Not enough votes to execute — threshold not met")]
    ThresholdNotMet,
    #[msg("Co-sign threshold must be between 1 and the signer count")]
    BadThreshold,

    // --- Hook ---
    #[msg("Wallet is on the deny list")]
    Denylisted,
    #[msg("Could not verify compliance state — transfer blocked")]
    ComplianceFault,
}
