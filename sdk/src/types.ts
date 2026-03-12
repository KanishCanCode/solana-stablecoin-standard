/**
 * @module types
 * TypeScript types mirroring the on-chain account layouts.
 *
 * Field names match the Rust struct fields exactly so Anchor's IDL
 * deserialization works out of the box without aliasing.
 */
import { PublicKey } from "@solana/web3.js";
import BN            from "bn.js";

// ─── Tier enum ────────────────────────────────────────────────────────────────

export enum Tier {
  /** Tier-1 Minimal — metadata + freeze authority */
  Minimal = 0,
  /** Tier-2 Compliant — + permanent delegate + transfer hook */
  Compliant = 1,
  /** Tier-3 Institutional — + rate limiting + timelock + co-sign gate */
  Institutional = 2,
}

// ─── On-chain account types ───────────────────────────────────────────────────

/** `IssuanceConfig` account — root config, one per mint. */
export interface IssuanceConfig {
  mint:                PublicKey;
  authority:           PublicKey;
  pendingAuthority:    PublicKey;
  authorityUnlockTs:   BN;
  issuer:              PublicKey;   // manages minter allowances
  guardian:            PublicKey;   // pause / halt
  compliance:          PublicKey;   // blacklist + confiscate
  tier:                Tier;
  halted:              boolean;     // true = all ops suspended
  totalIssued:         BN;
  totalBurned:         BN;
  totalSeized:         BN;
  eventSeq:            BN;
  windowSecs:          BN;
  windowCap:           BN;
  windowIssued:        BN;
  windowOpenedTs:      BN;
  cosignThreshold:     number;
  cosigners:           PublicKey[];
  nextProposal:        BN;
  bump:                number;
}

/** `MinterAllowance` account — per-minter cap tracking. */
export interface MinterAllowance {
  mint:    PublicKey;
  wallet:  PublicKey;   // the authorised minter wallet
  cap:     BN;          // maximum lifetime tokens
  issued:  BN;          // tokens minted so far (retire does not restore)
  enabled: boolean;
  bump:    number;
}

/** `MintProposal` account — pending co-sign request. */
export interface MintProposal {
  mint:      PublicKey;
  seq:       BN;
  proposer:  PublicKey;
  recipient: PublicKey;   // destination ATA
  amount:    BN;
  voteCount: number;
  voteMask:  number;      // bitmask — bit i = cosigners[i] voted
  executed:  boolean;
  expiresTs: BN;
  bump:      number;
}

// ─── Init params ──────────────────────────────────────────────────────────────

export interface IssueParamsTier1 {
  tier:     Tier.Minimal;
  name:     string;
  symbol:   string;
  uri:      string;
  decimals: number;
}

export interface IssueParamsTier2 extends Omit<IssueParamsTier1, "tier"> {
  tier:          Tier.Compliant;
  hookProgramId: PublicKey;
}

export interface IssueParamsTier3 extends Omit<IssueParamsTier2, "tier"> {
  tier:             Tier.Institutional;
  windowSecs?:      number;
  windowCap?:       bigint;
  cosignThreshold?: number;
  cosigners?:       PublicKey[];
}

export type IssueParams = IssueParamsTier1 | IssueParamsTier2 | IssueParamsTier3;

// ─── SDK options ──────────────────────────────────────────────────────────────

export interface IssuerClientOptions {
  rpcUrl?:       string;
  commitment?:   "processed" | "confirmed" | "finalized";
  skipPreflight?: boolean;
  coreProgramId?: PublicKey;
  hookProgramId?: PublicKey;
}

// ─── Result types ─────────────────────────────────────────────────────────────

export interface TxResult {
  signature: string;
  slot:      number;
}

export interface ProposeResult extends TxResult {
  seq:         BN;
  proposalPda: PublicKey;
}
