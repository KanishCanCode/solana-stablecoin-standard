//! `lock` / `unlock` — Freeze or thaw a token account.
//!
//! Operator must hold the `guardian` or `compliance` role.
//! The mint's freeze authority is the config PDA, so we sign as the PDA.

use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{
        freeze_account, thaw_account,
        FreezeAccount as SplFreeze, ThawAccount as SplThaw,
        Mint, TokenAccount,
    },
};
use sss_events::{AccountLocked, AccountUnlocked};

use crate::{
    constants::CONFIG_SEED,
    state::{IssuanceConfig, StablecoinError},
};

// ─── LockAccount (freeze) ─────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct LockAccount<'info> {
    /// Must be guardian or compliance role.
    pub operator: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump  = config.bump,
        constraint = (
            operator.key() == config.guardian ||
            operator.key() == config.compliance
        ) @ StablecoinError::ComplianceRoleRequired,
    )]
    pub config: Box<Account<'info, IssuanceConfig>>,

    #[account(
        mut,
        constraint = mint.key() == config.mint @ StablecoinError::AuthorityRequired,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = token_account.mint == mint.key() @ StablecoinError::AuthorityRequired,
    )]
    pub token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token2022>,
}

pub fn lock_handler(ctx: Context<LockAccount>) -> Result<()> {
    let config   = &mut ctx.accounts.config;
    let mint_key = config.mint;
    let bump     = config.bump;
    let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[bump]];

    freeze_account(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SplFreeze {
                mint:      ctx.accounts.mint.to_account_info(),
                account:   ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[seeds],
        ),
    )?;

    let seq = config.advance_seq();

    emit!(AccountLocked {
        mint:      mint_key,
        account:   ctx.accounts.token_account.key(),
        locked_by: ctx.accounts.operator.key(),
        seq,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}

// ─── UnlockAccount (thaw) ─────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct UnlockAccount<'info> {
    pub operator: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, mint.key().as_ref()],
        bump  = config.bump,
        constraint = (
            operator.key() == config.guardian ||
            operator.key() == config.compliance
        ) @ StablecoinError::ComplianceRoleRequired,
    )]
    pub config: Box<Account<'info, IssuanceConfig>>,

    #[account(
        mut,
        constraint = mint.key() == config.mint @ StablecoinError::AuthorityRequired,
    )]
    pub mint: Box<InterfaceAccount<'info, Mint>>,

    #[account(
        mut,
        constraint = token_account.mint == mint.key() @ StablecoinError::AuthorityRequired,
    )]
    pub token_account: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token2022>,
}

pub fn unlock_handler(ctx: Context<UnlockAccount>) -> Result<()> {
    let config   = &mut ctx.accounts.config;
    let mint_key = config.mint;
    let bump     = config.bump;
    let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[bump]];

    thaw_account(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            SplThaw {
                mint:      ctx.accounts.mint.to_account_info(),
                account:   ctx.accounts.token_account.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[seeds],
        ),
    )?;

    let seq = config.advance_seq();

    emit!(AccountUnlocked {
        mint:        mint_key,
        account:     ctx.accounts.token_account.key(),
        unlocked_by: ctx.accounts.operator.key(),
        seq,
        timestamp:   Clock::get()?.unix_timestamp,
    });

    Ok(())
}
