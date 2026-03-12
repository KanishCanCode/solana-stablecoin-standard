/**
 * @module pda
 * PDA derivation helpers.
 *
 * Seeds match the Rust constants in `programs/sss-core/src/constants.rs`:
 *   CONFIG_SEED   = b"stbl_config"
 *   MINTER_SEED   = b"stbl_minter"
 *   PROPOSAL_SEED = b"stbl_proposal"
 *
 * Hook program seeds (in sss-hook):
 *   HOOK_CONFIG_SEED        = b"stbl_hook_cfg"
 *   DENYLIST_ENTRY_SEED     = b"stbl_denylist"
 *   EXTRA_ACCOUNT_META_SEED = b"extra-account-metas"
 */

import { PublicKey } from "@solana/web3.js";

// ─── Core program seeds ───────────────────────────────────────────────────────
const CONFIG_SEED    = Buffer.from("stbl_config");
const MINTER_SEED    = Buffer.from("stbl_minter");
const PROPOSAL_SEED  = Buffer.from("stbl_proposal");

// ─── Hook program seeds ───────────────────────────────────────────────────────
const HOOK_CFG_SEED  = Buffer.from("stbl_hook_cfg");
const DENYLIST_SEED  = Buffer.from("stbl_denylist");
const EXTRA_META_SEED = Buffer.from("extra-account-metas");

// ─── Core PDAs ────────────────────────────────────────────────────────────────

/**
 * `IssuanceConfig` PDA.  Seeds: `["stbl_config", mint]`
 */
export function configPda(
  mint:      PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [CONFIG_SEED, mint.toBuffer()],
    programId
  );
}

/**
 * `MinterAllowance` PDA.  Seeds: `["stbl_minter", mint, wallet]`
 */
export function allowancePda(
  mint:      PublicKey,
  wallet:    PublicKey,
  programId: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MINTER_SEED, mint.toBuffer(), wallet.toBuffer()],
    programId
  );
}

/**
 * `MintProposal` PDA.  Seeds: `["stbl_proposal", mint, seq_le8]`
 */
export function proposalPda(
  mint:      PublicKey,
  seq:       bigint,
  programId: PublicKey
): [PublicKey, number] {
  const seqBuf = Buffer.alloc(8);
  seqBuf.writeBigUInt64LE(seq);
  return PublicKey.findProgramAddressSync(
    [PROPOSAL_SEED, mint.toBuffer(), seqBuf],
    programId
  );
}

// ─── Hook PDAs ────────────────────────────────────────────────────────────────

/** `HookConfig` PDA.  Seeds: `["stbl_hook_cfg", mint]` */
export function hookConfigPda(
  mint:    PublicKey,
  hookPid: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [HOOK_CFG_SEED, mint.toBuffer()],
    hookPid
  );
}

/** `DenylistEntry` PDA.  Seeds: `["stbl_denylist", mint, address]` */
export function denylistEntryPda(
  mint:    PublicKey,
  address: PublicKey,
  hookPid: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [DENYLIST_SEED, mint.toBuffer(), address.toBuffer()],
    hookPid
  );
}

/** `ExtraAccountMetaList` PDA.  Seeds: `["extra-account-metas", mint]` */
export function extraMetaListPda(
  mint:    PublicKey,
  hookPid: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [EXTRA_META_SEED, mint.toBuffer()],
    hookPid
  );
}
