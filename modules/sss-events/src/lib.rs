//! `sss-events` — Anchor event definitions for the SSS program suite.
//!
//! Naming design (consistent throughout):
//! - `TokensIssued` / `TokensRetired` / `TokensConfiscated` — supply events
//! - `AccountLocked` / `AccountUnlocked`                   — per-account state
//! - `OpsHalted` / `OpsResumed`                            — global ops gate
//! - `AddressDenied` / `AddressCleared`                    — denylist management
//! - `HandoverInitiated` / `HandoverComplete`              — authority transfer
//! - `MinterRegistered` / `MinterRevoked`                  — minter lifecycle
//! - `IssueProposed` / `IssueVoteCast` / `IssueExecuted`  — co-sign flow
//! - `Tier` enum                                           — feature tiers

use anchor_lang::prelude::*;

// ─── Tier enum ────────────────────────────────────────────────────────────────

/// Feature tier assigned at stablecoin deployment.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum Tier {
    /// Tier-1 Minimal — metadata + close authority.
    Minimal,
    /// Tier-2 Compliant — + permanent delegate + transfer hook + frozen default.
    Compliant,
    /// Tier-3 Institutional — + rate window + authority timelock + co-sign gate.
    Institutional,
}

// ─── Lifecycle ────────────────────────────────────────────────────────────────

#[event]
pub struct StablecoinDeployed {
    pub mint:      Pubkey,
    pub authority: Pubkey,
    pub tier:      Tier,
    pub decimals:  u8,
    pub name:      String,
    pub symbol:    String,
    pub seq:       u64,
    pub timestamp: i64,
}

// ─── Token supply ─────────────────────────────────────────────────────────────

#[event]
pub struct TokensIssued {
    pub mint:       Pubkey,
    pub issuer:     Pubkey,   // the minter wallet
    pub recipient:  Pubkey,
    pub amount:     u64,
    pub new_supply: u64,
    pub seq:        u64,
    pub timestamp:  i64,
}

#[event]
pub struct TokensRetired {
    pub mint:       Pubkey,
    pub holder:     Pubkey,
    pub source:     Pubkey,
    pub amount:     u64,
    pub new_supply: u64,
    pub seq:        u64,
    pub timestamp:  i64,
}

#[event]
pub struct TokensConfiscated {
    pub mint:              Pubkey,
    pub from:              Pubkey,
    pub to:                Pubkey,
    pub amount:            u64,
    pub total_confiscated: u64,
    pub seq:               u64,
    pub timestamp:         i64,
}

// ─── Account control ──────────────────────────────────────────────────────────

#[event]
pub struct AccountLocked {
    pub mint:      Pubkey,
    pub account:   Pubkey,
    pub locked_by: Pubkey,
    pub seq:       u64,
    pub timestamp: i64,
}

#[event]
pub struct AccountUnlocked {
    pub mint:        Pubkey,
    pub account:     Pubkey,
    pub unlocked_by: Pubkey,
    pub seq:         u64,
    pub timestamp:   i64,
}

// ─── Ops halt / resume ────────────────────────────────────────────────────────

#[event]
pub struct OpsHalted {
    pub mint:      Pubkey,
    pub halted_by: Pubkey,
    pub seq:       u64,
    pub timestamp: i64,
}

#[event]
pub struct OpsResumed {
    pub mint:       Pubkey,
    pub resumed_by: Pubkey,
    pub seq:        u64,
    pub timestamp:  i64,
}

// ─── Denylist ─────────────────────────────────────────────────────────────────

#[event]
pub struct AddressDenied {
    pub mint:      Pubkey,
    pub address:   Pubkey,
    pub denied_by: Pubkey,
    pub seq:       u64,
    pub timestamp: i64,
}

#[event]
pub struct AddressCleared {
    pub mint:       Pubkey,
    pub address:    Pubkey,
    pub cleared_by: Pubkey,
    pub seq:        u64,
    pub timestamp:  i64,
}

// ─── Role & authority ─────────────────────────────────────────────────────────

#[event]
pub struct RoleAssigned {
    pub mint:        Pubkey,
    pub role:        u8,
    pub old_address: Pubkey,
    pub new_address: Pubkey,
    pub assigned_by: Pubkey,
    pub seq:         u64,
    pub timestamp:   i64,
}

#[event]
pub struct HandoverInitiated {
    pub mint:        Pubkey,
    pub current:     Pubkey,
    pub incoming:    Pubkey,
    pub unlock_time: i64,
    pub seq:         u64,
    pub timestamp:   i64,
}

#[event]
pub struct HandoverComplete {
    pub mint:      Pubkey,
    pub new_owner: Pubkey,
    pub seq:       u64,
    pub timestamp: i64,
}

// ─── Minter management ────────────────────────────────────────────────────────

#[event]
pub struct MinterRegistered {
    pub mint:      Pubkey,
    pub wallet:    Pubkey,
    pub cap:       u64,
    pub is_new:    bool,
    pub seq:       u64,
    pub timestamp: i64,
}

#[event]
pub struct MinterRevoked {
    pub mint:      Pubkey,
    pub wallet:    Pubkey,
    pub seq:       u64,
    pub timestamp: i64,
}

// ─── SSS-3 rate window ────────────────────────────────────────────────────────

#[event]
pub struct WindowUpdated {
    pub mint:        Pubkey,
    pub window_secs: u64,
    pub window_cap:  u64,
    pub updated_by:  Pubkey,
    pub seq:         u64,
    pub timestamp:   i64,
}

// ─── SSS-3 co-sign issuance ───────────────────────────────────────────────────

#[event]
pub struct IssueProposed {
    pub mint:        Pubkey,
    pub proposal_id: u64,
    pub proposer:    Pubkey,
    pub recipient:   Pubkey,
    pub amount:      u64,
    pub seq:         u64,
    pub timestamp:   i64,
}

#[event]
pub struct IssueVoteCast {
    pub mint:        Pubkey,
    pub proposal_id: u64,
    pub voter:       Pubkey,
    pub vote_count:  u8,
    pub threshold:   u8,
    pub seq:         u64,
    pub timestamp:   i64,
}

#[event]
pub struct IssueExecuted {
    pub mint:        Pubkey,
    pub proposal_id: u64,
    pub executor:    Pubkey,
    pub amount:      u64,
    pub seq:         u64,
    pub timestamp:   i64,
}
