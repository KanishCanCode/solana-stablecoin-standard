# SSS-1 — Tier-1 Minimal Stablecoin

## Overview

SSS-1 defines the baseline stablecoin deployment using Token-2022. It adds no compliance machinery — only the minimum extensions required for a functional, upgradeable token.

## Token-2022 Extensions (Tier-1)

| Extension            | Purpose                                          |
|----------------------|--------------------------------------------------|
| `MetadataPointer`    | Points to on-chain metadata                      |
| `TokenMetadata`      | Stores `name`, `symbol`, `uri` on-chain          |
| `MintCloseAuthority` | Allows the config PDA to close the mint if empty |
| `FreezeAuthority`    | Enables freeze/thaw of individual token accounts |

## On-Chain Accounts

### `IssuanceConfig`

PDA: `["stbl_config", mint]`

Root configuration account. Fields relevant to Tier-1:

```
authority            Pubkey    — can do everything
pending_authority    Pubkey    — set during handover
authority_unlock_ts  i64       — timelock epoch (0 if no active handover)
issuer               Pubkey    — manages minter allowances (role index 0)
guardian             Pubkey    — halt/resume (role index 1)
compliance           Pubkey    — denylist + confiscate (role index 2)
tier                 Tier      — Minimal
halted               bool      — true = all ops blocked
total_issued         u64       — monotonically increasing
total_burned         u64       — monotonically increasing
total_seized         u64       — monotonically increasing
event_seq            u64       — per-mint event counter
bump                 u8
```

### `MinterAllowance`

PDA: `["stbl_minter", mint, wallet]`

```
mint     Pubkey    — links to IssuanceConfig
wallet   Pubkey    — authorised minter wallet
cap      u64       — maximum lifetime tokens (burns do NOT restore)
issued   u64       — tokens minted so far
enabled  bool      — false = revoked
bump     u8
```

## Instructions

### `initialize`

Deploys a new stablecoin. Extension initialization order is critical — all extensions must be initialized **before** `initialize_mint2`.

**Accounts:**
- `payer`        — pays rent
- `authority`    — initial authority
- `mint`         — new keypair (must sign)
- `config`       — `IssuanceConfig` PDA (init)
- `hook_program` — must be `None` for Tier-1
- `token_program` — Token-2022

### `register_minter`

Authorises a wallet to call `issue`. Only the `issuer` role may call this.
Cap is a **lifetime** quota — burning does not restore it.

### `revoke_minter`

Sets `enabled = false` on a `MinterAllowance`. Quota and history are preserved.

### `issue`

Mints tokens to a destination ATA. Checks:
1. `!halted`
2. `minter_allowance.enabled`
3. `minter_allowance.issued + amount ≤ minter_allowance.cap`
4. Tier-3: `cosign_threshold == 0` (direct issue only when no co-sign gate)

### `retire`

Burns tokens from a source ATA. Any token holder may retire their own tokens. Checks: `!halted`, `amount > 0`.

### `lock` / `unlock`

Freeze / thaw a token account. Either `guardian` or `compliance` role may call this.

### `halt` / `resume`

Suspends / restores all mint/retire/transfer operations. Only the `guardian` role.

### `assign_role`

Updates one of the three functional roles. Only `authority` may call this.

**Role indices:**
- `0` — issuer (manages minter allowances)
- `1` — guardian (halt / resume)
- `2` — compliance (denylist + confiscate)

### `init_handover` / `accept_handover`

Two-step authority transfer. On Tier-3, the handover is **timelocked 24 hours**. On Tier-1/2, it takes effect immediately upon `accept_handover`.

## Events

All events carry `seq` (monotonic per-mint counter) and `timestamp`.

| Event                | Trigger               |
|----------------------|-----------------------|
| `StablecoinDeployed` | `initialize`          |
| `TokensIssued`       | `issue`               |
| `TokensRetired`      | `retire`              |
| `AccountLocked`      | `lock`                |
| `AccountUnlocked`    | `unlock`              |
| `OpsHalted`          | `halt`                |
| `OpsResumed`         | `resume`              |
| `RoleAssigned`       | `assign_role`         |
| `MinterRegistered`   | `register_minter`     |
| `MinterRevoked`      | `revoke_minter`       |
| `HandoverInitiated`  | `init_handover`       |
| `HandoverComplete`   | `accept_handover`     |

## SDK Quick-Start

```typescript
import { IssuerClient, Tier } from "@sss/sdk";
import { Wallet } from "@coral-xyz/anchor";

const client = IssuerClient.forTier(Tier.Minimal, wallet);

// Deploy
const { mint, configPda } = await client.initialize(payer, {
  tier:     Tier.Minimal,
  name:     "ACME USD",
  symbol:   "AUSD",
  uri:      "https://acme.example/ausd.json",
  decimals: 6,
});

// Register a minter
await client.registerMinter(mint.publicKey, authorityKp, minterWallet, 1_000_000_000n);

// Issue tokens
await client.issue(mint.publicKey, minterKp, destinationAta, 500_000_000n);

// Retire tokens
await client.retire(mint.publicKey, holderKp, sourceAta, 100_000_000n);
```

## CLI Quick-Start

```bash
# Deploy
sss init --name "ACME USD" --symbol AUSD --tier minimal

# Status
sss status --mint <MINT>

# Issue
sss issue --mint <MINT> --destination <ATA> --amount 500000000

# Retire
sss retire --mint <MINT> --source <ATA> --amount 100000000
```
