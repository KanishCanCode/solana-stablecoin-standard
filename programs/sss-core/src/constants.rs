//! PDA seed constants — must mirror the TypeScript SDK seeds in `sdk/src/pda.ts`.
//!
//! Naming convention: `stbl_` prefix to distinguish from other programs on the same cluster.

/// Root config PDA  seeds: `[CONFIG_SEED, mint]`
pub const CONFIG_SEED: &[u8] = b"stbl_config";

/// Per-minter quota PDA  seeds: `[MINTER_SEED, mint, minter_wallet]`
pub const MINTER_SEED: &[u8] = b"stbl_minter";

/// Multi-sig proposal PDA  seeds: `[PROPOSAL_SEED, mint, proposal_id_le8]`
pub const PROPOSAL_SEED: &[u8] = b"stbl_proposal";
