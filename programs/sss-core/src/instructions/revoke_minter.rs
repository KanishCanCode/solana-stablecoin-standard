//! `revoke_minter` — Deactivate a minter.
//!
//! Sets `enabled = false`. The `MinterAllowance` account is retained for audit
//! (cap + issued remain visible). Issuing will fail with `AllowanceDisabled`
//! until re-activated via `register_minter`.

use anchor_lang::prelude::*;
use sss_events::MinterRevoked;

use crate::{
    constants::{CONFIG_SEED, MINTER_SEED},
    state::{IssuanceConfig, MinterAllowance, StablecoinError},
};

#[derive(Accounts)]
pub struct RevokeMinter<'info> {
    pub issuer: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump  = config.bump,
        constraint = config.issuer == issuer.key() @ StablecoinError::IssuerRoleRequired,
    )]
    pub config: Box<Account<'info, IssuanceConfig>>,

    #[account(
        mut,
        seeds  = [MINTER_SEED, config.mint.as_ref(), minter_allowance.wallet.as_ref()],
        bump   = minter_allowance.bump,
        constraint = minter_allowance.mint == config.mint @ StablecoinError::AuthorityRequired,
    )]
    pub minter_allowance: Box<Account<'info, MinterAllowance>>,
}

pub fn handler(ctx: Context<RevokeMinter>) -> Result<()> {
    let wallet = ctx.accounts.minter_allowance.wallet;
    ctx.accounts.minter_allowance.enabled = false;

    let seq = ctx.accounts.config.advance_seq();

    emit!(MinterRevoked {
        mint:      ctx.accounts.config.mint,
        wallet,
        seq,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
