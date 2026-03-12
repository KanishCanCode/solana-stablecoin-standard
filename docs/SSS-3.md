# SSS-3 — Institutional Stablecoin Standard

## Overview

SSS-3 extends SSS-2 (Compliant) with institutional-grade controls required by
large financial entities, regulated issuers, and consortium stablecoins.

Designed to satisfy MiCA Article 49 requirements and the GENIUS Act's reserve
management and operational controls.

---

## Additional Token-2022 Extensions

| Extension | Purpose |
|-----------|---------|
| All SSS-2 extensions | Inherited from Compliant tier |
| `TransferFeeConfig` (optional) | Fee-on-transfer for reserve accumulation |

---

## Feature Set

### 1. Rate-Limited Issuance

Limits total tokens issued within a configurable sliding time window.

**Parameters (set at init or via `set_window`):**

| Parameter | Field | Description |
|-----------|-------|-------------|
| Window duration | `window_secs` | Sliding window in seconds (0 = disabled) |
| Window cap | `window_cap` | Maximum tokens issuable within one window |

**Invariant**: `window_issued` ≤ `window_cap` at all times within a window.

**Window reset**: The window resets lazily on the next `issue` or `execute_issue`
call after `window_secs` has elapsed since `window_opened_ts`.

---

### 2. Co-Sign Issuance Gate

Large issuances require approval from N-of-M designated co-signers.

**Flow:**

```
proposer (minter)   → propose_issue(amount)
      ↓
cosigner[0..N-1]    → approve_issue(proposal_id) × threshold
      ↓
any cosigner        → execute_issue(proposal_id)
      ↓
Token-2022 mint_to  → destination ATA
```

**Constraints:**
- Proposals expire after **24 hours** (`expires_ts = now + 86400`)
- Retiring tokens does NOT restore quota (monotonic)
- Rate limit is re-checked at execution time
- Proposer's allowance cap is re-checked at execution time
- Executed proposals cannot be re-executed (`ProposalConsumed` error)

**Account: `MintProposal`**

```
PDA seeds: ["stbl_proposal", mint, proposal_id_le8]
```

| Field | Type | Description |
|-------|------|-------------|
| `seq` | u64 | Monotonically increasing proposal counter |
| `proposer` | Pubkey | The minter who proposed |
| `recipient` | Pubkey | Target ATA |
| `amount` | u64 | Tokens to issue |
| `vote_count` | u8 | Current vote count |
| `vote_mask` | u8 | Bitmask of which co-signers have voted |
| `executed` | bool | True after successful `execute_issue` |
| `expires_ts` | i64 | Unix timestamp of expiry |

---

### 3. Timelocked Authority Handover

Authority transfers impose a **24-hour timelock** between initiation and acceptance.

This provides a detection window for:
- Compromised authority key scenarios
- Social engineering / insider threats
- Accidental key rotation

**Flow:**
1. `init_handover(new_authority)` — sets `pending_authority` and
   `authority_unlock_ts = now + 86400`
2. Monitoring systems have 24 h to detect unauthorized transfers
3. `accept_handover()` — only executable after `authority_unlock_ts`

**Note**: SSS-1/SSS-2 retain the immediate two-step pattern (no timelock).

---

## Access Control Matrix

| Operation | SSS-1 | SSS-2 | SSS-3 |
|-----------|-------|-------|-------|
| `initialize` | authority | authority | authority |
| `issue` | minter | minter | minter (requires proposal if threshold > 0) |
| `propose_issue` | — | — | minter |
| `approve_issue` | — | — | cosigner |
| `execute_issue` | — | — | any cosigner |
| `retire` | token holder | token holder | token holder |
| `lock` | compliance, authority | compliance, authority | compliance, authority |
| `unlock` | compliance, authority | compliance, authority | compliance, authority |
| `halt` | guardian | guardian | guardian |
| `resume` | guardian | guardian | guardian |
| `confiscate` | — | compliance, authority | compliance, authority |
| `register_minter` | issuer | issuer | issuer |
| `revoke_minter` | issuer | issuer | issuer |
| `assign_role` | authority | authority | authority |
| `init_handover` | authority | authority | authority (24 h lock) |
| `accept_handover` | pending | pending | pending (after 24 h) |
| `set_window` | — | — | authority |

---

## Error Codes (SSS-3 specific)

| Code | Name | Description |
|------|------|-------------|
| 6010 | `WindowCapExceeded` | Issuance would exceed rate window cap |
| 6011 | `ProposalExpired` | Proposal TTL (24 h) has elapsed |
| 6012 | `ProposalConsumed` | Proposal was already executed |
| 6013 | `DuplicateVote` | This co-signer already voted |
| 6014 | `UnrecognisedCosigner` | Caller is not in the co-signer set |
| 6015 | `ThresholdNotMet` | Not enough votes to execute |
| 6016 | `BadThreshold` | Threshold = 0 or > co-signer count |
| 6007 | `HandoverLocked` | Authority handover timelock has not cleared |

---

## SDK Usage

```typescript
import { IssuerClient } from "@sss/sdk";
import { Tier }         from "@sss/sdk";

const client = IssuerClient.forTier(Tier.Institutional, wallet, {
  rpcUrl:        "https://api.mainnet-beta.solana.com",
  hookProgramId: HOOK_PROGRAM_ID,
});

// Initialize with 2-of-3 co-sign gate and 1-hour rate window
const { mint } = await client.initialize(authority, {
  tier:             Tier.Institutional,
  name:             "IUSD",
  symbol:           "IUSD",
  uri:              "https://issuer.com/iusd.json",
  decimals:         6,
  windowSecs:       3600,
  windowCap:        1_000_000_000_000n,    // 1 M tokens/hour
  cosignThreshold:  2,
  cosigners:        [signer1.publicKey, signer2.publicKey, signer3.publicKey],
});

// Propose an issuance
const { seq, proposalPda } = await client.proposeIssue(
  mint.publicKey, minter, destinationAta, 500_000_000_000n
);

// Co-signers vote (2 of 3 required)
await client.approveIssue(mint.publicKey, signer1, seq);
await client.approveIssue(mint.publicKey, signer2, seq);

// Execute — tokens are issued to destinationAta
await client.executeIssue(mint.publicKey, signer1, seq);
```

---

## Security Considerations

1. **Proposal expiry** prevents stale votes from executing after a key rotation.
2. **Vote bitmask** prevents co-signers from inflating the vote count through double-voting.
3. **Rate limit re-check at execution** prevents gaming via pre-approved batches.
4. **Timelocked handover** gives a 24-hour incident response window.
5. **Zero-address guard** on all role and authority updates prevents bricking.
