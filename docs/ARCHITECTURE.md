# Architecture — Solana Stablecoin Standard

## Layer Model

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Consumer Applications                          │
│            (DeFi protocols, payment apps, operator scripts)           │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ TypeScript SDK (@sss/sdk)
┌────────────────────────▼─────────────────────────────────────────────┐
│                    IssuerClient / CompliantClient                      │
│          ┌───────────────┬──────────────────┬──────────────┐         │
│          │ IssuerClient  │ CompliantClient   │ forTier(     │         │
│          │ (Tier-1)      │ (Tier-2)          │ Institutional│         │
│          └───────────────┴──────────────────┴──────────────┘         │
│                    PDA Helpers / Type-safe IDL                        │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ Anchor CPI / RPC
┌────────────────────────▼─────────────────────────────────────────────┐
│                  On-chain Programs (Anchor 0.32.1)                    │
│   ┌─────────────────────────────────┐  ┌──────────────────────────┐  │
│   │         sss-core                │  │        sss-hook           │  │
│   │  ┌─────────────────────────┐   │  │  ┌──────────────────────┐ │  │
│   │  │ Tier-1: 14 instructions │   │  │  │ Denylist CRUD         │ │  │
│   │  │ Tier-2: + confiscate    │   │  │  │ Transfer enforcement  │ │  │
│   │  │ Tier-3: + co-sign flow  │   │  │  │ Halt state check      │ │  │
│   │  │         + rate window   │   │  │  └──────────────────────┘ │  │
│   │  │         + handover lock │   │  │                            │  │
│   │  └─────────────────────────┘   │  └──────────────────────────┘  │
│   └─────────────────────────────────┘                                │
└────────────────────────┬─────────────────────────────────────────────┘
                         │ Token-2022 CPI
┌────────────────────────▼─────────────────────────────────────────────┐
│              Token-2022 Program Extensions                             │
│  MetadataPointer │ TokenMetadata │ MintCloseAuthority                 │
│  PermanentDelegate │ TransferHook │ DefaultAccountState(Frozen)        │
│  [Tier-3 opt] TransferFeeConfig                                       │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Data Flow: Issue (Tier-3 with co-sign gate)

```
Proposer (Minter)                 sss-core                    Token-2022
    │                                │                              │
    ├──propose_issue(amount)─────────▶│                              │
    │                          validate allowance cap               │
    │                          create MintProposal PDA              │
    │◀──── proposal seq ─────────────│                              │
    │                                │                              │
Cosigner[0]                         │                              │
    ├──approve_issue(seq)────────────▶│                              │
    │                          verify cosigner in set              │
    │                          set vote bit                        │
    │                          emit IssueVoteCast                  │
    │                                │                              │
Cosigner[1]                         │                              │
    ├──approve_issue(seq)────────────▶│                              │
    │                          vote_count == threshold              │
    │                          emit IssueVoteCast                  │
    │                                │                              │
Executor (any cosigner)             │                              │
    ├──execute_issue(seq)────────────▶│                              │
    │                          re-check allowance cap              │
    │                          re-check rate window                │
    │                          ──────────────────────────────────────▶│
    │                                │         mint_to(amount)      │
    │                                │◀── success ─────────────────│
    │                          proposal.executed = true             │
    │                          total_issued += amount               │
    │                          window_issued += amount              │
    │                          emit IssueExecuted                   │
    │◀── TxSignature ────────────────│                              │
```

---

## Data Flow: Confiscate (Tier-2/3)

```
Operator (compliance/authority)     sss-core          Token-2022       sss-hook
    │                                │                    │                │
    ├──confiscate(amount, accts=[])──▶│                    │                │
    │                          verify tier ≥ Compliant    │                │
    │                          verify compliance role     │                │
    │                          build manual CPI ix        │                │
    │                          invoke_signed ─────────────▶│               │
    │                                │    transfer_checked                 │
    │                                │          │──callback────────────────▶│
    │                                │          │                  check halted
    │                                │          │                  check denylist
    │                                │          │◀── Ok() ─────────────────│
    │                                │◀── success│                   │
    │                          total_seized += amount                │
    │                          emit TokensConfiscated                │
    │◀── TxSignature ────────────────│                               │
```

**Why manual CPI?**  `anchor-spl::transfer_checked` (v0.32.1) discards
`remaining_accounts`, breaking the extra-account-meta chain required by the
Transfer Hook Interface.  We use `spl_token_2022::instruction::transfer_checked`
+ `invoke_signed` directly to pass hook accounts through.

---

## PDA Map

| Account | Seeds | Owner |
|---------|-------|-------|
| `IssuanceConfig` | `["stbl_config", mint]` | `sss-core` |
| `MinterAllowance` | `["stbl_minter", mint, wallet]` | `sss-core` |
| `MintProposal` | `["stbl_proposal", mint, proposal_seq_le8]` | `sss-core` |
| `HookConfig` | `["stbl_hook_cfg", mint]` | `sss-hook` |
| `DenylistEntry` | `["stbl_denylist", mint, address]` | `sss-hook` |
| `ExtraAccountMetaList` | `["extra-account-metas", mint]` | `sss-hook` |

---

## Security Architecture

### Access Control
- Role-based model with five principals: `authority`, `issuer`, `guardian`,
  `compliance`, and co-signers
- All role addresses default to `authority` at init; delegable independently
- Zero-address guard prevents role bricking on all updates

### Fail-Closed Transfer Hook
- The hook checks halt state and denylist on every Token-2022 transfer
- **If the hook config account is missing or unreadable, the transfer is blocked**
- This prevents a config-close exploit from bypassing compliance

### Audit Trail
- Every state change emits a structured Anchor event with a monotonic `event_seq`
- `total_issued`, `total_burned`, `total_seized` are on-chain and tamper-evident
- Invariant: `total_issued - total_burned ≈ current_supply` (verifiable off-chain)

### Tier-3 Additional Controls
- Rate limiting with lazy window resets (no cron dependency)
- Co-sign gate with per-signer bitmask (prevents double-voting)
- 24-hour authority handover timelock for incident response
