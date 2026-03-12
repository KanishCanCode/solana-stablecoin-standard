/**
 * @sss/sdk — Solana Stablecoin Standard TypeScript SDK
 *
 * @example
 * ```ts
 * import { IssuerClientFactory, Tier, configPda } from "@sss/sdk";
 *
 * const client = IssuerClientFactory.forTier(Tier.Compliant, wallet, {
 *   hookProgramId: HOOK_PROGRAM_ID,
 * });
 * ```
 */

// Clients
export { IssuerClient }                           from "./issuer";
export { CompliantClient, InstitutionalClient }   from "./compliant";
export { IssuerClientFactory }                    from "./factory";

// PDAs
export { configPda, allowancePda, proposalPda, hookConfigPda, denylistEntryPda, extraMetaListPda } from "./pda";

// Types
export type { IssuanceConfig, MinterAllowance, MintProposal, IssueParams, IssueParamsTier1, IssueParamsTier2, IssueParamsTier3, IssuerClientOptions, TxResult, ProposeResult } from "./types";
export { Tier } from "./types";
