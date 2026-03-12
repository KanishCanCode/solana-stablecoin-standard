//! `retire` — Retire (burn) stablecoins from a source ATA.
//!
//! Any token holder may retire their own balance. Guards: not halted, amount > 0.
//! Retiring does NOT restore a minter's allowance — quota is monotonically consumed.

use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{burn, Burn, Mint, TokenAccount},
};
use sss_events::TokensRetired;

use crate::{
    constants::CONFIG_SEED,
    state::{IssuanceConfig, StablecoinError},
};

#[derive(Accounts)]
pub struct RetireBurn<'info> {
    /// The token holder retiring their tokens.
    pub holder: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump  = config.bump,
    )]
    pub config: Box<Account<'info, IssuanceConfig>>,

    #[account(
        mut,
        constraint = mint.key() == config.mint @ StablecoinError::AuthorityRequired,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    /// The source ATA to retire from. Holder must be the ATA owner.
    #[account(
        mut,
        constraint = source.mint  == mint.key()         @ StablecoinError::AuthorityRequired,
        constraint = source.owner == holder.key()       @ StablecoinError::AuthorityRequired,
    )]
    pub source: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<RetireBurn>, amount: u64) -> Result<()> {
    require!(amount > 0, StablecoinError::ZeroAmount);

    let config = &mut ctx.accounts.config;
    require!(!config.halted, StablecoinError::Halted);

    burn(
        CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint:      ctx.accounts.mint.to_account_info(),
                from:      ctx.accounts.source.to_account_info(),
                authority: ctx.accounts.holder.to_account_info(),
            },
        ),
        amount,
    )?;

    config.total_burned = config
        .total_burned
        .checked_add(amount)
        .ok_or(error!(StablecoinError::Overflow))?;

    let seq = config.advance_seq();

    emit!(TokensRetired {
        mint:       config.mint,
        holder:     ctx.accounts.holder.key(),
        source:     ctx.accounts.source.key(),
        amount,
        new_supply: ctx.accounts.mint.supply,
        seq,
        timestamp:  Clock::get()?.unix_timestamp,
    });

    Ok(())
}
