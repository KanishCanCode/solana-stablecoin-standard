//! `issue` — Issue (mint) new stablecoins to a destination ATA.
//!
//! Checks (in order):
//! 1. Not halted
//! 2. Minter allowance enabled
//! 3. Quota not exceeded (monotonic — retire does NOT restore)
//! 4. SSS-3 rate-limit window not exceeded
//! 5. SSS-3 co-sign gate: if cosign_threshold > 0, must use propose_issue instead

use anchor_lang::prelude::*;
use anchor_spl::{
    token_2022::Token2022,
    token_interface::{Mint, TokenAccount, mint_to, MintTo},
};
use sss_events::TokensIssued;

use crate::{
    constants::*,
    state::{IssuanceConfig, MinterAllowance, StablecoinError},
};

#[derive(Accounts)]
pub struct IssueMint<'info> {
    pub minter: Signer<'info>,

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

    #[account(
        mut,
        seeds = [MINTER_SEED, mint.key().as_ref(), minter.key().as_ref()],
        bump  = minter_allowance.bump,
        constraint = minter_allowance.mint   == config.mint  @ StablecoinError::AuthorityRequired,
        constraint = minter_allowance.wallet == minter.key() @ StablecoinError::AuthorityRequired,
    )]
    pub minter_allowance: Box<Account<'info, MinterAllowance>>,

    #[account(
        mut,
        constraint = destination.mint == mint.key() @ StablecoinError::AuthorityRequired,
    )]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token2022>,
}

pub fn handler(ctx: Context<IssueMint>, amount: u64) -> Result<()> {
    require!(amount > 0, StablecoinError::ZeroAmount);

    let config           = &mut ctx.accounts.config;
    let minter_allowance = &mut ctx.accounts.minter_allowance;
    let now              = Clock::get()?.unix_timestamp;

    // 1. Halt check
    require!(!config.halted, StablecoinError::Halted);

    // 2. Allowance enabled
    require!(minter_allowance.enabled, StablecoinError::AllowanceDisabled);

    // 3. Quota check
    let new_issued = minter_allowance
        .issued
        .checked_add(amount)
        .ok_or(error!(StablecoinError::Overflow))?;
    require!(new_issued <= minter_allowance.cap, StablecoinError::AllowanceCapExceeded);

    // 4. Rate-limit window (no-op when window_secs == 0)
    config.window_allows(amount, now)?;

    // 5. Co-sign gate — direct issue blocked when threshold is active
    require!(
        config.cosign_threshold == 0,
        StablecoinError::ThresholdNotMet
    );

    // 6. Mint via PDA signer
    let mint_key    = ctx.accounts.mint.key();
    let config_bump = config.bump;
    let seeds: &[&[u8]] = &[CONFIG_SEED, mint_key.as_ref(), &[config_bump]];

    mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint:      ctx.accounts.mint.to_account_info(),
                to:        ctx.accounts.destination.to_account_info(),
                authority: ctx.accounts.config.to_account_info(),
            },
            &[seeds],
        ),
        amount,
    )?;

    // 7. Update state
    minter_allowance.issued = new_issued;

    config.total_issued = config
        .total_issued
        .checked_add(amount)
        .ok_or(error!(StablecoinError::Overflow))?;
    config.record_window_mint(amount, now)?;
    let seq = config.advance_seq();

    // 8. Emit
    emit!(TokensIssued {
        mint:       mint_key,
        issuer:     ctx.accounts.minter.key(),  // field is `issuer`, account is `minter`
        recipient:  ctx.accounts.destination.key(),
        amount,
        new_supply: ctx.accounts.mint.supply,
        seq,
        timestamp:  now,
    });

    Ok(())
}
