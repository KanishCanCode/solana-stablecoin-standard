//! `sss-hook` — SPL Transfer Hook for SSS-2 / SSS-3 compliance enforcement.
//!
//! Called automatically by Token-2022 on every `transfer_checked`.
//!
//! ## Checks (fail-closed design)
//! 1. Sender denylist  — if sender's `DenylistEntry` PDA exists, block transfer.
//! 2. Receiver denylist — same for receiver.
//!
//! The hook ONLY enforces the denylist.  Halt-state enforcement is handled
//! directly in sss-core before any CPI that would trigger a transfer, so there
//! is no need to cross-read the core config here.
//!
//! ## Account layout passed by Token-2022
//! ```text
//! Base (fixed by protocol):
//!   0: source token account
//!   1: mint
//!   2: destination token account
//!   3: source owner / authority
//!   4: extra_account_meta_list PDA  (this program)
//! Extra (appended from ExtraAccountMetaList, zero-indexed in remaining_accounts):
//!   0: hook_config PDA
//!   1: sender denylist entry PDA
//!   2: receiver denylist entry PDA
//! ```
//!
//! ## Fail-closed property
//! If extra accounts are missing or unreadable, the transfer is BLOCKED.

use anchor_lang::prelude::*;
use spl_tlv_account_resolution::{account::ExtraAccountMeta, seeds::Seed, state::ExtraAccountMetaList};

declare_id!("SSSHkQxWmNvEfHdTpY8cLrUaGb3xJ6nKo2Di4AlVsRqP");

// ─── PDA seeds ────────────────────────────────────────────────────────────────

pub const HOOK_CONFIG_SEED:        &[u8] = b"stbl_hook_cfg";
/// Seed value is fixed for wire-format / PDA stability on deployed chains.
pub const DENYLIST_ENTRY_SEED:     &[u8] = b"stbl_denylist";
pub const EXTRA_ACCOUNT_META_SEED: &[u8] = b"extra-account-metas";

// Number of extra accounts registered in ExtraAccountMetaList.
const NUM_EXTRA_ACCOUNTS: usize = 3;

// Pre-computed space for ExtraAccountMetaList with NUM_EXTRA_ACCOUNTS entries.
// TLV layout: type(2) + length(4) + count(4) + N * ExtraAccountMeta(35)
// = 10 + 3*35 = 115 bytes.
const EXTRA_META_LIST_SPACE: usize = 10 + NUM_EXTRA_ACCOUNTS * 35;

// ─── On-chain state ───────────────────────────────────────────────────────────

/// Hook configuration — stores references needed at execute time.
#[account]
pub struct HookConfig {
    /// The Token-2022 mint this hook is bound to.
    pub mint: Pubkey,
    pub bump: u8,
}

impl HookConfig {
    pub const LEN: usize = 8 + 32 + 1;
}

/// Per-address denylist entry.
/// Existence of this account at the PDA = address is denied.
///
/// PDA seeds: `[DENYLIST_ENTRY_SEED, mint, address]`
#[account]
pub struct DenylistEntry {
    pub mint:    Pubkey,
    pub address: Pubkey,
    pub bump:    u8,
}

impl DenylistEntry {
    pub const LEN: usize = 8 + 32 + 32 + 1;
}

#[error_code]
pub enum HookError {
    #[msg("Transfer blocked: sender address is denied")]
    SenderDenied,
    #[msg("Transfer blocked: receiver address is denied")]
    ReceiverDenied,
    #[msg("Transfer blocked: compliance state unavailable")]
    ComplianceCheckFailed,
}

// ─── Program ─────────────────────────────────────────────────────────────────

#[program]
pub mod sss_hook {
    use super::*;

    /// Initialise the `ExtraAccountMetaList` and `HookConfig` PDAs.
    /// Must be called once after the hook is registered on the Token-2022 mint.
    pub fn initialize_extra_account_meta_list(
        ctx: Context<InitializeExtraAccountMetaList>,
    ) -> Result<()> {
        let mint_key = ctx.accounts.mint.key();
        let bump     = ctx.bumps.extra_account_meta_list;

        // ── Write HookConfig ─────────────────────────────────────────────────
        let hook_config  = &mut ctx.accounts.hook_config;
        hook_config.mint = mint_key;
        hook_config.bump = ctx.bumps.hook_config;

        // ── Allocate ExtraAccountMetaList via CPI to System Program ──────────
        //
        // We cannot use Anchor's `init` constraint for this account because
        // ExtraAccountMetaList is a raw TLV buffer, not an Anchor account type.
        let space    = EXTRA_META_LIST_SPACE;
        let lamports = Rent::get()?.minimum_balance(space);
        let seeds: &[&[u8]] = &[EXTRA_ACCOUNT_META_SEED, mint_key.as_ref(), &[bump]];

        anchor_lang::system_program::create_account(
            CpiContext::new_with_signer(
                ctx.accounts.system_program.to_account_info(),
                anchor_lang::system_program::CreateAccount {
                    from: ctx.accounts.payer.to_account_info(),
                    to:   ctx.accounts.extra_account_meta_list.to_account_info(),
                },
                &[seeds],
            ),
            lamports,
            space as u64,
            &crate::ID,
        )?;

        // ── Register extra accounts ───────────────────────────────────────────
        // Account index reference for seeds (Token-2022 convention):
        //   0 = source token account
        //   1 = mint
        //   2 = destination token account
        //   3 = source owner
        //   4 = extra_account_meta_list
        let extra_accounts = vec![
            // Extra[0]: hook_config PDA  seeds: [HOOK_CONFIG_SEED, mint]
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal  { bytes: HOOK_CONFIG_SEED.to_vec() },
                    Seed::AccountKey { index: 1 }, // mint is account index 1
                ],
                false, // is_signer
                false, // is_writable
            )?,
            // Extra[1]: sender denylist entry  seeds: [DENYLIST_ENTRY_SEED, mint, source_owner]
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal  { bytes: DENYLIST_ENTRY_SEED.to_vec() },
                    Seed::AccountKey { index: 1 }, // mint
                    Seed::AccountKey { index: 3 }, // source owner
                ],
                false,
                false,
            )?,
            // Extra[2]: receiver denylist entry  seeds: [DENYLIST_ENTRY_SEED, mint, dest_ata]
            ExtraAccountMeta::new_with_seeds(
                &[
                    Seed::Literal  { bytes: DENYLIST_ENTRY_SEED.to_vec() },
                    Seed::AccountKey { index: 1 }, // mint
                    Seed::AccountKey { index: 2 }, // destination token account
                ],
                false,
                false,
            )?,
        ];

        ExtraAccountMetaList::init::<ExecuteInstruction>(
            &mut ctx.accounts.extra_account_meta_list.try_borrow_mut_data()?,
            &extra_accounts,
        )?;

        Ok(())
    }

    /// Called by Token-2022 on every `transfer_checked`.
    /// The extra accounts registered above are appended to remaining_accounts.
    pub fn execute<'info>(
        ctx: Context<'_, '_, '_, 'info, Execute<'info>>,
        _amount: u64,
    ) -> Result<()> {
        // Extra accounts are appended in the order registered:
        //   remaining_accounts[0] = hook_config
        //   remaining_accounts[1] = sender_denylist_entry
        //   remaining_accounts[2] = receiver_denylist_entry
        let extras = ctx.remaining_accounts;

        // Fail-closed: if extra accounts are missing, block the transfer.
        if extras.len() < 3 {
            return err!(HookError::ComplianceCheckFailed);
        }

        let sender_entry_ai   = &extras[1];
        let receiver_entry_ai = &extras[2];

        // A non-zero-lamport account at the PDA = address is denied.
        require!(!is_denied(sender_entry_ai),   HookError::SenderDenied);
        require!(!is_denied(receiver_entry_ai), HookError::ReceiverDenied);

        Ok(())
    }

    /// Add an address to the denylist. Called by the `compliance` role via CPI.
    pub fn add_to_denylist(ctx: Context<AddToDenylist>) -> Result<()> {
        let entry     = &mut ctx.accounts.denylist_entry;
        entry.mint    = ctx.accounts.mint.key();
        entry.address = ctx.accounts.address.key();
        entry.bump    = ctx.bumps.denylist_entry;
        Ok(())
    }

    /// Remove an address from the denylist.
    /// The account is closed (lamports returned to compliance signer), making
    /// the PDA non-existent — subsequent transfer checks see the address as clean.
    pub fn remove_from_denylist(_ctx: Context<RemoveFromDenylist>) -> Result<()> {
        Ok(())
    }
}

// ─── Helper ──────────────────────────────────────────────────────────────────

/// Returns true if an initialised DenylistEntry account exists at this address.
/// An uninitialised (zero-lamport or empty) account means the address is clean.
fn is_denied(ai: &AccountInfo) -> bool {
    if ai.lamports() == 0 || ai.data_is_empty() {
        return false;
    }
    // Any initialised non-empty account at the denylist PDA = address is denied.
    // We check that data length is at least the discriminator (8 bytes).
    match ai.try_borrow_data() {
        Ok(data) => data.len() >= 8,
        Err(_)   => true, // fail-closed: if we can't read it, treat as denied
    }
}

// ─── Account contexts ─────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeExtraAccountMetaList<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// CHECK: Allocated manually via CPI in the handler. Seeds verified here.
    #[account(
        mut,
        seeds = [EXTRA_ACCOUNT_META_SEED, mint.key().as_ref()],
        bump,
    )]
    pub extra_account_meta_list: UncheckedAccount<'info>,

    #[account(
        init,
        payer  = payer,
        space  = HookConfig::LEN,
        seeds  = [HOOK_CONFIG_SEED, mint.key().as_ref()],
        bump,
    )]
    pub hook_config: Account<'info, HookConfig>,

    /// CHECK: Token-2022 mint — used for PDA derivation only.
    pub mint: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

/// Account context for the transfer hook execute instruction.
/// Token-2022 passes these accounts in a fixed order; extra accounts
/// registered in ExtraAccountMetaList are appended to remaining_accounts.
#[derive(Accounts)]
pub struct Execute<'info> {
    /// CHECK: Source token account.
    pub source:      AccountInfo<'info>,
    /// CHECK: Mint.
    pub mint:        AccountInfo<'info>,
    /// CHECK: Destination token account.
    pub destination: AccountInfo<'info>,
    /// CHECK: Source owner (wallet that signed the transfer).
    pub owner:       AccountInfo<'info>,
    /// CHECK: ExtraAccountMetaList PDA owned by this program.
    pub extra_metas: AccountInfo<'info>,
}

/// Discriminator used when initialising the ExtraAccountMetaList so Token-2022
/// can locate the entry for this hook program.
pub struct ExecuteInstruction;
impl anchor_lang::Discriminator for ExecuteInstruction {
    const DISCRIMINATOR: &'static [u8] = &spl_transfer_hook_interface::instruction::ExecuteInstruction::SPL_DISCRIMINATOR_SLICE;
}

#[derive(Accounts)]
pub struct AddToDenylist<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The `compliance` role signer. Caller is responsible for verifying
    /// this matches the compliance address stored in sss-core's IssuanceConfig.
    pub compliance: Signer<'info>,

    /// CHECK: The address to add to the denylist.
    pub address: AccountInfo<'info>,
    /// CHECK: Token-2022 mint.
    pub mint: AccountInfo<'info>,

    #[account(
        init,
        payer  = payer,
        space  = DenylistEntry::LEN,
        seeds  = [DENYLIST_ENTRY_SEED, mint.key().as_ref(), address.key().as_ref()],
        bump,
    )]
    pub denylist_entry: Account<'info, DenylistEntry>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RemoveFromDenylist<'info> {
    pub compliance: Signer<'info>,
    /// CHECK: Mint.
    pub mint: AccountInfo<'info>,
    /// CHECK: Address to remove.
    pub address: AccountInfo<'info>,

    #[account(
        mut,
        close  = compliance,
        seeds  = [DENYLIST_ENTRY_SEED, mint.key().as_ref(), address.key().as_ref()],
        bump   = denylist_entry.bump,
    )]
    pub denylist_entry: Account<'info, DenylistEntry>,
}
