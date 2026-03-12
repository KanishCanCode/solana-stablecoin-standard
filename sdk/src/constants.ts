/**
 * @module constants
 * Hard-coded program addresses and domain constants.
 *
 * Naming mirrors the Rust program constants exactly:
 * - Roles: ROLE_ISSUER (0) / ROLE_GUARDIAN (1) / ROLE_COMPLIANCE (2)
 * - Timelock constant is HANDOVER_LOCK_SECS (not AUTHORITY_TIMELOCK_SECONDS)
 */
import { PublicKey } from "@solana/web3.js";

export const CORE_PROGRAM_ID = new PublicKey(
  "SSSTkn4G7RLuGDL1i5zKi2JoW6FpZ3wXCbQn9PmVkRzP"
);
export const HOOK_PROGRAM_ID = new PublicKey(
  "SSSHkQxWmNvEfHdTpY8cLrUaGb3xJ6nKo2Di4AlVsRqP"
);

export const DEFAULT_RPC_URL    = "https://api.devnet.solana.com";
export const DEFAULT_COMMITMENT = "confirmed" as const;

/** Role index constants — mirror ROLE_* in sss-core/src/state.rs */
export const ROLE_ISSUER     = 0;  // manages minter allowances
export const ROLE_GUARDIAN   = 1;  // pause / halt
export const ROLE_COMPLIANCE = 2;  // blacklist + confiscate

/** 24-hour authority handover timelock (Tier-3 only) */
export const HANDOVER_LOCK_SECS = 86_400;
