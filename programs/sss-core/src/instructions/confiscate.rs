//! `confiscate` — Transfer tokens from a non-compliant account to the treasury.
//!
//! **Tier-2 / Tier-3 only.**
//!
//! Uses manual CPI construction (NOT `anchor_spl::transfer_checked`) because
//! `anchor-spl` v0.32.1 drops `remaining_accounts`, making it incompatible
//! with Token-2022 transfer hooks.  We build the instruction via
//! `spl_token_2022::instruction::transfer_checked` and call `invoke_signed`
//! with the full hook extra-account-metas chain.

use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{Mint, TokenAccount};
use sss_events::{Tier, TokensConfiscated};

use crate::{
    constants::*,
    state::{IssuanceConfig, StablecoinError},
};

#[derive(Accounts)]
pub struct Confiscate<'info> {
    /// Must be `compliance` role or `authority`.
    pub operator: Signer<'info>,

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

    /// Source — the account being confiscated from.
    #[account(
        mut,
        constraint = source.mint == mint.key() @ StablecoinError::AuthorityRequired,
    )]
    pub source: Box<InterfaceAccount<'info, TokenAccount>>,

    /// Destination — compliance treasury ATA.
    #[account(
        mut,
        constraint = destination.mint == mint.key() @ StablecoinError::AuthorityRequired,
    )]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token2022>,
    // remaining_accounts: ExtraAccountMetaList PDA, hook program,
    // hook config PDA — as required by spl_transfer_hook_interface.
}

pub fn handler<'info>(
    ctx: Context<'_, '_, '_, 'info, Confiscate<'info>>,
    amount: u64,
) -> Result<()> {
    require!(amount > 0, StablecoinError::ZeroAmount);

    let config = &mut ctx.accounts.config;

    // Tier check: Tier-2 and Tier-3 only
    require!(
        config.tier != Tier::Minimal,
        StablecoinError::TierInsufficient
    );

    // Access control: compliance officer or authority
    let op = ctx.accounts.operator.key();
    require!(
        op == config.compliance || op == config.authority,
        StablecoinError::ComplianceRoleRequired
    );

    // Build transfer_checked instruction with hook extra-accounts
    let mint_key    = ctx.accounts.mint.key();
    let config_bump = config.bump;
    let config_seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[config_bump]];

    let mut account_infos = vec![
        ctx.accounts.source.to_account_info(),
        ctx.accounts.mint.to_account_info(),
        ctx.accounts.destination.to_account_info(),
        ctx.accounts.config.to_account_info(),
    ];
    let mut account_metas = vec![
        AccountMeta::new(ctx.accounts.source.key(), false),
        AccountMeta::new(ctx.accounts.mint.key(), false),
        AccountMeta::new(ctx.accounts.destination.key(), false),
        AccountMeta::new_readonly(ctx.accounts.config.key(), true),
    ];

    for ai in ctx.remaining_accounts.iter() {
        let meta = if ai.is_writable {
            AccountMeta::new(ai.key(), ai.is_signer)
        } else {
            AccountMeta::new_readonly(ai.key(), ai.is_signer)
        };
        account_metas.push(meta);
        account_infos.push(ai.clone());
    }

    let ix = spl_token_2022::instruction::transfer_checked(
        &spl_token_2022::ID,
        &ctx.accounts.source.key(),
        &mint_key,
        &ctx.accounts.destination.key(),
        &ctx.accounts.config.key(), // permanent delegate = config PDA
        &[],
        amount,
        ctx.accounts.mint.decimals,
    )?;

    let mut final_metas = ix.accounts.clone();
    for extra in account_metas.iter().skip(4) {
        if !final_metas.iter().any(|m| m.pubkey == extra.pubkey) {
            final_metas.push(extra.clone());
        }
    }

    let ix_with_hook = solana_program::instruction::Instruction {
        program_id: spl_token_2022::ID,
        accounts:   final_metas,
        data:       ix.data,
    };

    solana_program::program::invoke_signed(
        &ix_with_hook,
        &account_infos,
        &[config_seeds],
    )?;

    // Update audit counters
    let new_confiscated = config
        .total_seized
        .checked_add(amount)
        .ok_or(error!(StablecoinError::Overflow))?;
    config.total_seized = new_confiscated;
    let seq = config.advance_seq();

    emit!(TokensConfiscated {
        mint:              mint_key,
        from:              ctx.accounts.source.key(),
        to:                ctx.accounts.destination.key(),
        amount,
        total_confiscated: new_confiscated,   // field is `total_confiscated`
        seq,
        timestamp:         Clock::get()?.unix_timestamp,
    });

    Ok(())
}
