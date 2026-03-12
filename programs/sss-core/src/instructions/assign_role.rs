//! `assign_role` — Update a functional role address.
//!
//! Only the current `authority` may change role assignments.
//! Role indices:
//!   0 = issuer     (manages minter allowances)
//!   1 = guardian   (halt / resume / lock / unlock)
//!   2 = compliance (denylist + confiscate)

use anchor_lang::prelude::*;
use sss_events::RoleAssigned;

use crate::{
    constants::CONFIG_SEED,
    state::{
        IssuanceConfig, StablecoinError,
        ROLE_COMPLIANCE, ROLE_ISSUER, ROLE_GUARDIAN,
    },
};

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct AssignRoleParams {
    /// Role index: 0 = issuer, 1 = guardian, 2 = compliance.
    pub role:        u8,
    pub new_address: Pubkey,
}

#[derive(Accounts)]
pub struct AssignRole<'info> {
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [CONFIG_SEED, config.mint.as_ref()],
        bump  = config.bump,
        constraint = config.authority == authority.key() @ StablecoinError::AuthorityRequired,
    )]
    pub config: Box<Account<'info, IssuanceConfig>>,
}

pub fn handler(ctx: Context<AssignRole>, params: AssignRoleParams) -> Result<()> {
    require!(params.new_address != Pubkey::default(), StablecoinError::ZeroAddress);

    let config = &mut ctx.accounts.config;
    let old_address;

    match params.role {
        ROLE_ISSUER => {
            old_address = config.issuer;
            config.issuer = params.new_address;
        }
        ROLE_GUARDIAN => {
            old_address = config.guardian;
            config.guardian = params.new_address;
        }
        ROLE_COMPLIANCE => {
            old_address = config.compliance;
            config.compliance = params.new_address;
        }
        _ => return err!(StablecoinError::AuthorityRequired),
    }

    let seq = config.advance_seq();   

    emit!(RoleAssigned {
        mint:        config.mint,
        role:        params.role,
        old_address,                        // field is `old_address`
        new_address: params.new_address,    // field is `new_address`
        assigned_by: ctx.accounts.authority.key(), // field is `assigned_by`
        seq,
        timestamp:   Clock::get()?.unix_timestamp,
    });

    Ok(())
}
