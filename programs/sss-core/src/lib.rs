//! `sss-core` — Solana Stablecoin Standard core program.
//!
//! Three compliance tiers, all sharing a single on-chain program:
//!
//! | Tier | Label        | Features added                                            |
//! |------|--------------|-----------------------------------------------------------|
//! | 1    | Minimal      | Metadata, freeze authority, close authority               |
//! | 2    | Compliant    | + Permanent delegate, transfer hook, default-frozen       |
//! | 3    | Institutional| + Rate-limited minting, authority timelock, co-sign gate  |
//!
//! **Naming conventions** (distinct from other SSS implementations):
//! - Config account: `IssuanceConfig`  — PDA seeds `["stbl_config", mint]`
//! - Minter account: `MinterAllowance` — PDA seeds `["stbl_minter", mint, wallet]`
//! - Proposal:       `MintProposal`    — PDA seeds `["stbl_proposal", mint, seq_le8]`
//! - Roles:          `issuer` / `guardian` / `compliance`
//! - Operational gate: `halted` field on `IssuanceConfig`

use anchor_lang::prelude::*;

pub mod constants;
pub mod state;
pub mod instructions {
    pub mod initialize;
    pub mod issue;
    pub mod retire;
    pub mod lock;
    pub mod halt;
    pub mod confiscate;
    pub mod register_minter;
    pub mod revoke_minter;
    pub mod assign_role;
    pub mod handover;
    pub mod cosign_mint;
    pub mod set_window;
}

use instructions::{
    initialize::{Initialize, IssueParams},
    issue::IssueMint,
    retire::RetireBurn,
    lock::{LockAccount, UnlockAccount},
    halt::{HaltOps, ResumeOps},
    confiscate::Confiscate,
    register_minter::{RegisterMinter, RegisterMinterParams},
    revoke_minter::RevokeMinter,
    assign_role::{AssignRole, AssignRoleParams},
    handover::{InitHandover, AcceptHandover},
    cosign_mint::{ProposeIssue, ApproveIssue, ExecuteIssue},
    set_window::{SetWindow, SetWindowParams},
};

declare_id!("SSSTkn4G7RLuGDL1i5zKi2JoW6FpZ3wXCbQn9PmVkRzP");

#[program]
pub mod sss_core {
    use super::*;

    // ═══ Lifecycle ════════════════════════════════════════════════════════════

    /// Deploy a new stablecoin on Token-2022 with the chosen compliance tier.
    pub fn initialize(ctx: Context<Initialize>, params: IssueParams) -> Result<()> {
        instructions::initialize::handler(ctx, params)
    }

    // ═══ Token supply ═════════════════════════════════════════════════════════

    /// Issue (mint) tokens to a destination ATA.
    /// For Tier-3 with `cosign_threshold > 0`, use `propose_issue` instead.
    pub fn issue(ctx: Context<IssueMint>, amount: u64) -> Result<()> {
        instructions::issue::handler(ctx, amount)
    }

    /// Retire (burn) tokens from the caller's ATA.
    pub fn retire(ctx: Context<RetireBurn>, amount: u64) -> Result<()> {
        instructions::retire::handler(ctx, amount)
    }

    // ═══ Account control ═════════════════════════════════════════════════════

    /// Lock (freeze) a token account — guardian or compliance role.
    pub fn lock(ctx: Context<LockAccount>) -> Result<()> {
        instructions::lock::lock_handler(ctx)
    }

    /// Unlock (thaw) a frozen token account.
    pub fn unlock(ctx: Context<UnlockAccount>) -> Result<()> {
        instructions::lock::unlock_handler(ctx)
    }

    /// Halt all operations — guardian role only.
    pub fn halt(ctx: Context<HaltOps>) -> Result<()> {
        instructions::halt::halt_handler(ctx)
    }

    /// Resume halted operations — guardian role only.
    pub fn resume(ctx: Context<ResumeOps>) -> Result<()> {
        instructions::halt::resume_handler(ctx)
    }

    /// Confiscate tokens from a non-compliant account (Tier-2/3).
    pub fn confiscate<'info>(
        ctx: Context<'_, '_, '_, 'info, Confiscate<'info>>,
        amount: u64,
    ) -> Result<()> {
        instructions::confiscate::handler(ctx, amount)
    }

    // ═══ Minter management ════════════════════════════════════════════════════

    /// Register a new minter or update an existing minter's cap.
    pub fn register_minter(
        ctx:    Context<RegisterMinter>,
        params: RegisterMinterParams,
    ) -> Result<()> {
        instructions::register_minter::handler(ctx, params)
    }

    /// Revoke a minter — cap is preserved for audit, minting is blocked.
    pub fn revoke_minter(ctx: Context<RevokeMinter>) -> Result<()> {
        instructions::revoke_minter::handler(ctx)
    }

    // ═══ Role management ══════════════════════════════════════════════════════

    /// Assign a new address to a functional role (issuer / guardian / compliance).
    pub fn assign_role(ctx: Context<AssignRole>, params: AssignRoleParams) -> Result<()> {
        instructions::assign_role::handler(ctx, params)
    }

    // ═══ Authority handover ═══════════════════════════════════════════════════

    /// Initiate a two-step authority handover (timelocked 24 h on Tier-3).
    pub fn init_handover(ctx: Context<InitHandover>, incoming: Pubkey) -> Result<()> {
        instructions::handover::init_handler(ctx, incoming)
    }

    /// Complete the pending handover — incoming authority must sign.
    pub fn accept_handover(ctx: Context<AcceptHandover>) -> Result<()> {
        instructions::handover::accept_handler(ctx)
    }

    // ═══ Tier-3 co-sign gate ══════════════════════════════════════════════════

    /// Propose a mint operation requiring co-signer approval (Tier-3).
    pub fn propose_issue(ctx: Context<ProposeIssue>, amount: u64) -> Result<()> {
        instructions::cosign_mint::propose_issue_handler(ctx, amount)
    }

    /// Record a co-signer vote on a pending issue proposal.
    pub fn approve_issue(ctx: Context<ApproveIssue>) -> Result<()> {
        instructions::cosign_mint::approve_issue_handler(ctx)
    }

    /// Execute an approved issue proposal — any co-signer may execute.
    pub fn execute_issue(ctx: Context<ExecuteIssue>) -> Result<()> {
        instructions::cosign_mint::execute_issue_handler(ctx)
    }

    // ═══ Tier-3 rate window ═══════════════════════════════════════════════════

    /// Update sliding-window rate-limit parameters — authority only.
    pub fn set_window(ctx: Context<SetWindow>, params: SetWindowParams) -> Result<()> {
        instructions::set_window::handler(ctx, params)
    }
}
