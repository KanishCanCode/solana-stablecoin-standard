//! `halt` / `resume` — Suspend and restore all operations.
//!
//! Only the `guardian` role may call either instruction.
//! Halting an already-halted contract is idempotent.

use anchor_lang::prelude::*;
use sss_events::{OpsHalted, OpsResumed};

use crate::{
    constants::CONFIG_SEED,
    state::{IssuanceConfig, StablecoinError},
};

// ─── HaltOps ─────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct HaltOps<'info> {
    pub guardian: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump  = config.bump,
        constraint = config.guardian == guardian.key() @ StablecoinError::GuardianRoleRequired,
    )]
    pub config: Box<Account<'info, IssuanceConfig>>,
}

pub fn halt_handler(ctx: Context<HaltOps>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.halted = true;
    let seq = config.advance_seq();

    emit!(OpsHalted {
        mint:      config.mint,
        halted_by: ctx.accounts.guardian.key(),
        seq,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

// ─── ResumeOps ────────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct ResumeOps<'info> {
    pub guardian: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump  = config.bump,
        constraint = config.guardian == guardian.key() @ StablecoinError::GuardianRoleRequired,
    )]
    pub config: Box<Account<'info, IssuanceConfig>>,
}

pub fn resume_handler(ctx: Context<ResumeOps>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.halted = false;
    let seq = config.advance_seq();

    emit!(OpsResumed {
        mint:       config.mint,
        resumed_by: ctx.accounts.guardian.key(),
        seq,
        timestamp:  Clock::get()?.unix_timestamp,
    });

    Ok(())
}
