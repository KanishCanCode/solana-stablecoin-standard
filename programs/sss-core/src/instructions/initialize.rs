//! `initialize` — Deploy a new stablecoin with the chosen tier.
//!
//! ## Token-2022 Extension Init Order (critical)
//!
//! SPL Token-2022 extensions MUST be initialised BEFORE `initialize_mint2`.
//! Anchor's `mint::init` constraint calls `initialize_mint2` automatically,
//! so we cannot use it here.  Instead the caller:
//!
//! 1. Creates a bare account via `SystemProgram::create_account` sized with
//!    `getMintLen([...extensions])` from `@solana/spl-token`.
//! 2. Passes it as a `mut` + `signer` unchecked account.
//!
//! We then call extension init instructions in order, and finally
//! `initialize_mint2` last, so Token-2022 sees all extension data in place.
//!
//! Extension matrix:
//! ┌─────────────────────┬────────┬─────────┬──────────────┐
//! │ Extension           │ SSS-1  │  SSS-2  │    SSS-3     │
//! ├─────────────────────┼────────┼─────────┼──────────────┤
//! │ MetadataPointer     │   ✓    │    ✓    │      ✓       │
//! │ MintCloseAuthority  │   ✓    │    ✓    │      ✓       │
//! │ PermanentDelegate   │        │    ✓    │      ✓       │
//! │ TransferHook        │        │    ✓    │      ✓       │
//! │ DefaultAccountState │        │    ✓    │      ✓       │
//! └─────────────────────┴────────┴─────────┴──────────────┘

use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;
use spl_token_2022::{
    extension::{
        default_account_state, metadata_pointer, mint_close_authority, permanent_delegate,
        transfer_hook,
    },
    instruction::initialize_mint2,
    state::AccountState,
};
use sss_events::{Tier, StablecoinDeployed};

use crate::{
    constants::*,
    state::{IssuanceConfig, StablecoinError},
};

/// Initialization parameters passed from client.
#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct IssueParams {
    pub name: String,
    pub symbol: String,
    pub uri: String,
    pub decimals: u8,
    pub tier: Tier,
    /// Rolling window duration in seconds (0 = off, Tier-3 only).
    pub window_secs: u64,
    /// Maximum tokens issuable per window (0 = off, Tier-3 only).
    pub window_cap: u64,
    /// Votes required before a proposal executes (0 = off, SSS-3 only).
    pub cosign_threshold: u8,
    /// Co-signer wallet set (up to 5, SSS-3 only).
    pub cosigners: Vec<Pubkey>,
}

#[derive(Accounts)]
#[instruction(params: IssueParams)]
pub struct Initialize<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The initial authority for this stablecoin.
    pub authority: Signer<'info>,

    /// Pre-allocated Token-2022 mint account (must be created by caller with correct
    /// space for all extensions via `SystemProgram::create_account`).
    /// CHECK: We initialise extensions + initialize_mint2 manually in the handler.
    #[account(mut, signer)]
    pub mint: UncheckedAccount<'info>,

    /// Config PDA — stores all stablecoin state.
    #[account(
        init,
        payer  = payer,
        space  = IssuanceConfig::LEN,
        seeds  = [CONFIG_SEED, mint.key().as_ref()],
        bump,
    )]
    pub config: Box<Account<'info, IssuanceConfig>>,

    /// Hook program — required for Tier-2/3. We only read its key.
    /// CHECK: Validated as non-None when tier requires it.
    pub hook_program: Option<UncheckedAccount<'info>>,

    pub token_program: Program<'info, Token2022>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<Initialize>, params: IssueParams) -> Result<()> {
    // ── 1. Input validation ───────────────────────────────────────────────────
    require!(!params.name.is_empty() && params.name.len() <= 32, StablecoinError::ZeroAmount);
    require!(!params.symbol.is_empty() && params.symbol.len() <= 10, StablecoinError::ZeroAmount);

    if params.tier != Tier::Minimal {
        require!(ctx.accounts.hook_program.is_some(), StablecoinError::HookRequired);
    }

    if params.tier == Tier::Institutional && params.cosign_threshold > 0 {
        require!(
            !params.cosigners.is_empty() && params.cosigners.len() <= 5,
            StablecoinError::BadThreshold
        );
        require!(
            (params.cosign_threshold as usize) <= params.cosigners.len(),
            StablecoinError::BadThreshold
        );
        for s in &params.cosigners {
            require!(*s != Pubkey::default(), StablecoinError::ZeroAddress);
        }
    }

    // ── 2. Write config PDA ───────────────────────────────────────────────────
    let mint_key    = ctx.accounts.mint.key();
    let config_bump = ctx.bumps.config;
    let config_pda  = ctx.accounts.config.key();
    let auth_key    = ctx.accounts.authority.key();
    let now         = Clock::get()?.unix_timestamp;

    {
        let cfg = &mut ctx.accounts.config;
        cfg.mint                = mint_key;
        cfg.authority           = auth_key;
        cfg.pending_authority   = Pubkey::default();
        cfg.authority_unlock_ts = 0;
        cfg.issuer              = auth_key;
        cfg.guardian            = auth_key;
        cfg.compliance          = auth_key;
        cfg.tier                = params.tier;
        cfg.halted              = false;
        cfg.total_issued        = 0;
        cfg.total_burned        = 0;
        cfg.total_seized        = 0;
        cfg.event_seq           = 0;
        cfg.bump                = config_bump;
        cfg.window_secs         = params.window_secs;
        cfg.window_cap          = params.window_cap;
        cfg.window_issued       = 0;
        cfg.window_opened_ts    = now;
        cfg.cosign_threshold    = params.cosign_threshold;
        cfg.next_proposal       = 0;

        let mut signers = [Pubkey::default(); 5];
        for (i, s) in params.cosigners.iter().enumerate().take(5) {
            signers[i] = *s;
        }
        cfg.cosigners = signers;
    }

    // ── 3. Initialise Token-2022 extensions BEFORE initialize_mint2 ──────────
    //
    // Extensions are registered on the raw, uninitialized mint account data.
    // The mint keypair must sign the transaction (enforced via `signer` constraint).
    // No PDA signer is needed here — the mint is still just a regular keypair.

    let mint_ai = ctx.accounts.mint.to_account_info();

    // SSS-1, 2, 3: MetadataPointer (points to mint itself for embedded metadata)
    solana_program::program::invoke(
        &metadata_pointer::instruction::initialize(
            &spl_token_2022::ID,
            &mint_key,
            Some(auth_key), // metadata update authority
            Some(mint_key), // metadata account = mint itself
        )?,
        &[mint_ai.clone()],
    )?;

    // SSS-1, 2, 3: MintCloseAuthority (authority reclaims rent when supply == 0)
    solana_program::program::invoke(
        &mint_close_authority::instruction::initialize(
            &spl_token_2022::ID,
            &mint_key,
            Some(&config_pda), // only config PDA (the program) can close the mint
        )?,
        &[mint_ai.clone()],
    )?;

    if params.tier != Tier::Minimal {
        let hook_pid = ctx.accounts.hook_program.as_ref().unwrap().key();

        // SSS-2, 3: PermanentDelegate — allows config PDA to move any tokens (seize).
        solana_program::program::invoke(
            &permanent_delegate::instruction::initialize(
                &spl_token_2022::ID,
                &mint_key,
                &config_pda, // config PDA is the permanent delegate
            )?,
            &[mint_ai.clone()],
        )?;

        // SSS-2, 3: TransferHook — Token-2022 calls sss-hook on every transfer.
        solana_program::program::invoke(
            &transfer_hook::instruction::initialize(
                &spl_token_2022::ID,
                &mint_key,
                Some(auth_key),  // hook update authority
                Some(hook_pid),  // the hook program
            )?,
            &[mint_ai.clone()],
        )?;

        // SSS-2, 3: DefaultAccountState(Frozen) — new ATAs must be thawed by issuer.
        solana_program::program::invoke(
            &default_account_state::instruction::initialize_default_account_state(
                &spl_token_2022::ID,
                &mint_key,
                &AccountState::Frozen,
            )?,
            &[mint_ai.clone()],
        )?;
    }

    // ── 4. initialize_mint2 — MUST be last ────────────────────────────────────
    //
    // Mint authority = config PDA (only the program can mint).
    // Freeze authority = config PDA (program controls freeze/thaw).
    solana_program::program::invoke(
        &initialize_mint2(
            &spl_token_2022::ID,
            &mint_key,
            &config_pda,       // mint authority
            Some(&config_pda), // freeze authority
            params.decimals,
        )?,
        &[mint_ai.clone()],
    )?;

    // ── 5. Emit event ─────────────────────────────────────────────────────────
    let seq = ctx.accounts.config.advance_seq();
    emit!(StablecoinDeployed {
        mint:      mint_key,
        authority: auth_key,
        tier:      params.tier,
        decimals:  params.decimals,
        name:      params.name,
        symbol:    params.symbol,
        seq,
        timestamp: now,
    });

    Ok(())
}
