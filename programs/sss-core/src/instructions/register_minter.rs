//! `register_minter` — Authorise a minter and set its lifetime issuance cap.
//!
//! Creates a new `MinterAllowance` account if one doesn't exist (via `init_if_needed`),
//! or updates the cap of an existing minter.  Only the `issuer` role may call this.
//!
//! Retiring tokens does NOT restore quota — it is monotonically consumed.

use anchor_lang::prelude::*;
use sss_events::MinterRegistered;

use crate::{
    constants::{CONFIG_SEED, MINTER_SEED},
    state::{IssuanceConfig, MinterAllowance, StablecoinError},
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct RegisterMinterParams {
    /// The wallet that will be authorised to call `issue`.
    pub wallet: Pubkey,
    /// Maximum lifetime tokens this minter may issue.
    pub cap: u64,
}

#[derive(Accounts)]
#[instruction(params: RegisterMinterParams)]
pub struct RegisterMinter<'info> {
    pub issuer: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump  = config.bump,
        constraint = config.issuer == issuer.key() @ StablecoinError::IssuerRoleRequired,
    )]
    pub config: Box<Account<'info, IssuanceConfig>>,

    #[account(
        init_if_needed,
        payer  = issuer,
        space  = MinterAllowance::LEN,
        seeds  = [MINTER_SEED, config.mint.as_ref(), params.wallet.as_ref()],
        bump,
    )]
    pub minter_allowance: Box<Account<'info, MinterAllowance>>,

    /// CHECK: The mint is only used for the PDA seed — no on-chain mint data needed here.
    pub mint: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<RegisterMinter>, params: RegisterMinterParams) -> Result<()> {
    require!(params.wallet != Pubkey::default(), StablecoinError::ZeroAddress);

    let is_new = ctx.accounts.minter_allowance.mint == Pubkey::default();
    let minter_allowance = &mut ctx.accounts.minter_allowance;

    // Always (re-)set these fields so `register_minter` acts as both create and update.
    minter_allowance.mint    = ctx.accounts.config.mint;
    minter_allowance.wallet  = params.wallet;
    minter_allowance.cap     = params.cap;
    minter_allowance.enabled = true;

    if is_new {
        minter_allowance.issued = 0;
        minter_allowance.bump   = ctx.bumps.minter_allowance;
    }
    // Note: on update, `issued` is preserved (monotonic — retire does not restore quota).

    let seq = ctx.accounts.config.advance_seq();

    emit!(MinterRegistered {
        mint:      ctx.accounts.config.mint,
        wallet:    params.wallet,
        cap:       params.cap,
        is_new,
        seq,
        timestamp: Clock::get()?.unix_timestamp,
    });

    Ok(())
}
