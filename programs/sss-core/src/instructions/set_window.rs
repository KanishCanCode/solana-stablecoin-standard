//! `set_window` — Update sliding-window rate-limit parameters (Tier-3 only).
//!
//! Only the current `authority` may update rate limits.
//! Setting `window_secs` to 0 disables rate limiting entirely.

use anchor_lang::prelude::*;
use sss_events::{Tier, WindowUpdated};

use crate::{
    constants::CONFIG_SEED,
    state::{IssuanceConfig, StablecoinError},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct SetWindowParams {
    /// Sliding window in seconds. 0 = disabled.
    pub window_secs: u64,       
    /// Maximum tokens issuable per window.
    pub window_cap:  u64,       
}

#[derive(Accounts)]
pub struct SetWindow<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump  = config.bump,
        constraint = config.authority == authority.key() @ StablecoinError::AuthorityRequired,
    )]
    pub config: Box<Account<'info, IssuanceConfig>>,
}

pub fn handler(ctx: Context<SetWindow>, params: SetWindowParams) -> Result<()> {
    let config = &mut ctx.accounts.config;

    require!(
        config.tier == Tier::Institutional,
        StablecoinError::TierInsufficient
    );

    config.window_secs      = params.window_secs;
    config.window_cap       = params.window_cap;
    // Reset window so the new limit takes effect immediately
    config.window_issued    = 0;
    config.window_opened_ts = Clock::get()?.unix_timestamp;

    let seq = config.advance_seq();   

    emit!(WindowUpdated {
        mint:        config.mint,
        window_secs: params.window_secs,   // field is `window_secs`
        window_cap:  params.window_cap,    // field is `window_cap`
        updated_by:  ctx.accounts.authority.key(),
        seq,
        timestamp:   Clock::get()?.unix_timestamp,
    });

    Ok(())
}
