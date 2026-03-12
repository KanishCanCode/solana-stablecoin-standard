//! `init_handover` / `accept_handover` — Two-step authority transfer.
//!
//! **SSS-1 / SSS-2**: Sets `pending_authority` immediately; no timelock.
//! **SSS-3**: Sets `pending_authority` AND starts a 24-hour timelock
//! (`authority_unlock_ts = now + HANDOVER_LOCK_SECS`).
//!
//! Only the pending authority may call `accept_handover`, and only after the
//! timelock has cleared (SSS-3) or immediately (SSS-1/2).
//! Rejecting `Pubkey::default()` prevents accidentally bricking the contract.

use anchor_lang::prelude::*;
use sss_events::{HandoverInitiated, Tier};

use crate::{
    constants::*,
    state::{IssuanceConfig, StablecoinError, HANDOVER_LOCK_SECS},
};

// ─── init_handover ────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitHandover<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump  = config.bump,
        constraint = config.authority == authority.key() @ StablecoinError::AuthorityRequired,
    )]
    pub config: Box<Account<'info, IssuanceConfig>>,
}

pub fn init_handler(ctx: Context<InitHandover>, new_authority: Pubkey) -> Result<()> {
    require!(new_authority != Pubkey::default(), StablecoinError::ZeroAddress);
    require!(
        new_authority != ctx.accounts.config.authority,
        StablecoinError::AuthorityRequired
    );

    let config = &mut ctx.accounts.config;
    let now    = Clock::get()?.unix_timestamp;

    config.pending_authority = new_authority;

    // SSS-3: apply a 24-hour timelock so monitoring systems have a detection window.
    let unlock_time = if config.tier == Tier::Institutional {
        let t = now
            .checked_add(HANDOVER_LOCK_SECS)
            .ok_or(error!(StablecoinError::Overflow))?;
        config.authority_unlock_ts = t;
        t
    } else {
        config.authority_unlock_ts = 0;
        0
    };

    let seq = config.advance_seq();

    emit!(HandoverInitiated {
        mint:        config.mint,
        current:     config.authority,
        incoming:    new_authority,
        unlock_time,
        seq,
        timestamp:   now,
    });

    Ok(())
}

// ─── accept_handover ──────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct AcceptHandover<'info> {
    pub pending: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump  = config.bump,
        constraint = config.pending_authority == pending.key() @ StablecoinError::PendingAuthorityRequired,
    )]
    pub config: Box<Account<'info, IssuanceConfig>>,
}

pub fn accept_handler(ctx: Context<AcceptHandover>) -> Result<()> {
    let config = &mut ctx.accounts.config;
    let now    = Clock::get()?.unix_timestamp;

    require!(
        config.pending_authority != Pubkey::default(),
        StablecoinError::NoPendingHandover
    );

    // Enforce timelock for SSS-3.
    if config.tier == Tier::Institutional && config.authority_unlock_ts > 0 {
        require!(now >= config.authority_unlock_ts, StablecoinError::HandoverLocked);
    }

    let new_auth = config.pending_authority;
    config.authority           = new_auth;
    config.pending_authority   = Pubkey::default();
    config.authority_unlock_ts = 0;

    let seq = config.advance_seq();

    emit!(sss_events::HandoverComplete {
        mint:      config.mint,
        new_owner: new_auth,
        seq,
        timestamp: now,
    });

    Ok(())
}
