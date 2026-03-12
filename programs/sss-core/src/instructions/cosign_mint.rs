//! Co-sign issuance flow (SSS-3 only).
//!
//! Large issuances require approval from N-of-M designated co-signers
//! before tokens are minted.
//!
//! Flow:
//! 1. Any active minter calls `propose_issue`  → creates [`MintProposal`]
//! 2. Each configured co-signer calls `approve_issue` → increments vote count
//! 3. Once votes ≥ threshold, any co-signer calls `execute_issue` → tokens issued
//!
//! Proposals expire after 24 hours.  Executed proposals cannot be replayed.

use anchor_lang::prelude::*;
use anchor_spl::{token_2022::Token2022, token_interface::{Mint, TokenAccount, mint_to, MintTo}};
use sss_events::{Tier, IssueProposed, IssueVoteCast, IssueExecuted};

use crate::{
    constants::*,
    state::{IssuanceConfig, MinterAllowance, MintProposal, StablecoinError},
};

const PROPOSAL_TTL: i64 = 86_400; // 24 hours

// ─── propose_issue ────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct ProposeIssue<'info> {
    #[account(mut)]
    pub proposer: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump  = config.bump,
    )]
    pub config: Box<Account<'info, IssuanceConfig>>,

    #[account(
        seeds = [MINTER_SEED, config.mint.as_ref(), proposer.key().as_ref()],
        bump  = minter_allowance.bump,
        constraint = minter_allowance.enabled @ StablecoinError::AllowanceDisabled,
    )]
    pub minter_allowance: Box<Account<'info, MinterAllowance>>,

    #[account(
        init,
        payer = proposer,
        space = MintProposal::LEN,
        seeds = [
            PROPOSAL_SEED,
            config.mint.as_ref(),
            &config.next_proposal.to_le_bytes(),
        ],
        bump,
    )]
    pub proposal: Box<Account<'info, MintProposal>>,

    pub destination:    Box<InterfaceAccount<'info, TokenAccount>>,
    pub system_program: Program<'info, System>,
}

pub fn propose_issue_handler(ctx: Context<ProposeIssue>, amount: u64) -> Result<()> {
    require!(amount > 0, StablecoinError::ZeroAmount);

    let config = &mut ctx.accounts.config;

    require!(!config.halted, StablecoinError::Halted);
    require!(config.tier == Tier::Institutional, StablecoinError::TierInsufficient);
    require!(config.cosign_threshold > 0, StablecoinError::BadThreshold);

    // Pre-check quota (also re-checked at execution).
    let new_issued = ctx.accounts.minter_allowance
        .issued
        .checked_add(amount)
        .ok_or(error!(StablecoinError::Overflow))?;
    require!(
        new_issued <= ctx.accounts.minter_allowance.cap,
        StablecoinError::AllowanceCapExceeded
    );

    let now         = Clock::get()?.unix_timestamp;
    let proposal_id = config.next_proposal;
    config.next_proposal = proposal_id
        .checked_add(1)
        .ok_or(error!(StablecoinError::Overflow))?;

    let proposal       = &mut ctx.accounts.proposal;
    proposal.mint      = config.mint;
    proposal.seq       = proposal_id;
    proposal.proposer  = ctx.accounts.proposer.key();
    proposal.recipient = ctx.accounts.destination.key();
    proposal.amount    = amount;
    proposal.vote_count = 0;
    proposal.vote_mask  = 0;
    proposal.executed  = false;
    proposal.expires_ts = now
        .checked_add(PROPOSAL_TTL)
        .ok_or(error!(StablecoinError::Overflow))?;
    proposal.bump = ctx.bumps.proposal;

    let seq = config.advance_seq();

    emit!(IssueProposed {
        mint:        config.mint,
        proposal_id,
        proposer:    ctx.accounts.proposer.key(),
        recipient:   ctx.accounts.destination.key(),
        amount,
        seq,
        timestamp:   now,
    });

    Ok(())
}

// ─── approve_issue ────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct ApproveIssue<'info> {
    pub cosigner: Signer<'info>,

    #[account(
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump  = config.bump,
    )]
    pub config: Box<Account<'info, IssuanceConfig>>,

    #[account(
        mut,
        seeds = [
            PROPOSAL_SEED,
            config.mint.as_ref(),
            &proposal.seq.to_le_bytes(),
        ],
        bump = proposal.bump,
        constraint = proposal.mint == config.mint @ StablecoinError::AuthorityRequired,
    )]
    pub proposal: Box<Account<'info, MintProposal>>,
}

pub fn approve_issue_handler(ctx: Context<ApproveIssue>) -> Result<()> {
    let config   = &ctx.accounts.config;
    let proposal = &mut ctx.accounts.proposal;
    let cosigner = ctx.accounts.cosigner.key();
    let now      = Clock::get()?.unix_timestamp;

    require!(!proposal.executed,        StablecoinError::ProposalConsumed);
    require!(now < proposal.expires_ts, StablecoinError::ProposalExpired);

    let idx = config
        .cosigners
        .iter()
        .position(|&s| s == cosigner)
        .ok_or(error!(StablecoinError::UnrecognisedCosigner))? as u8;

    let bit = 1u8 << idx;
    require!(proposal.vote_mask & bit == 0, StablecoinError::DuplicateVote);

    proposal.vote_mask  |= bit;
    proposal.vote_count  = proposal
        .vote_count
        .checked_add(1)
        .ok_or(error!(StablecoinError::Overflow))?;

    // Approval seq is read from config — it was already incremented by propose_issue_handler,
    // so we don't advance it again here (vote events share the proposal's seq namespace).
    emit!(IssueVoteCast {
        mint:        config.mint,
        proposal_id: proposal.seq,
        voter:       cosigner,
        vote_count:  proposal.vote_count,
        threshold:   config.cosign_threshold,
        seq:         proposal.seq,
        timestamp:   now,
    });

    Ok(())
}

// ─── execute_issue ────────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct ExecuteIssue<'info> {
    pub executor: Signer<'info>,

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
        seeds = [
            PROPOSAL_SEED,
            config.mint.as_ref(),
            &proposal.seq.to_le_bytes(),
        ],
        bump = proposal.bump,
        constraint = proposal.mint == config.mint @ StablecoinError::AuthorityRequired,
    )]
    pub proposal: Box<Account<'info, MintProposal>>,

    #[account(
        mut,
        seeds = [MINTER_SEED, config.mint.as_ref(), proposal.proposer.as_ref()],
        bump  = minter_allowance.bump,
    )]
    pub minter_allowance: Box<Account<'info, MinterAllowance>>,

    #[account(
        mut,
        constraint = destination.key() == proposal.recipient @ StablecoinError::AuthorityRequired,
    )]
    pub destination: Box<InterfaceAccount<'info, TokenAccount>>,

    pub token_program: Program<'info, Token2022>,
}

pub fn execute_issue_handler(ctx: Context<ExecuteIssue>) -> Result<()> {
    let config   = &mut ctx.accounts.config;
    let proposal = &mut ctx.accounts.proposal;
    let now      = Clock::get()?.unix_timestamp;

    require!(!config.halted,            StablecoinError::Halted);
    require!(!proposal.executed,        StablecoinError::ProposalConsumed);
    require!(now < proposal.expires_ts, StablecoinError::ProposalExpired);
    require!(
        proposal.vote_count >= config.cosign_threshold,
        StablecoinError::ThresholdNotMet
    );

    let amount = proposal.amount;

    // Final guards — re-checked at execution to prevent quota gaming.
    let new_issued = ctx.accounts.minter_allowance
        .issued
        .checked_add(amount)
        .ok_or(error!(StablecoinError::Overflow))?;
    require!(new_issued <= ctx.accounts.minter_allowance.cap, StablecoinError::AllowanceCapExceeded);
    config.window_allows(amount, now)?;

    // Issue tokens — config PDA is the mint authority.
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

    proposal.executed = true;
    ctx.accounts.minter_allowance.issued = new_issued;
    config.total_issued = config.total_issued
        .checked_add(amount)
        .ok_or(error!(StablecoinError::Overflow))?;
    config.record_window_mint(amount, now)?;
    let seq = config.advance_seq();

    emit!(IssueExecuted {
        mint: mint_key,
        proposal_id: proposal.seq,
        executor:    ctx.accounts.executor.key(),
        amount,
        seq,
        timestamp:   now,
    });

    Ok(())
}
