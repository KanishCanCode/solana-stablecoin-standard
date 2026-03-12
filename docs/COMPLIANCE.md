# Compliance Operations Guide

This guide covers all compliance operations available in SSS-2 and SSS-3 stablecoins.

## Role Hierarchy

```
Authority  (full control, two-step handover)
  └── Issuer       (manages MinterAllowance accounts)
  └── Guardian     (halt / resume / lock / unlock)
  └── Compliance   (denylist / confiscate)
```

All role assignments emit a `RoleAssigned` event with old and new addresses.

## Halt / Resume

**Who:** `guardian` role  
**Effect:** Sets `IssuanceConfig.halted = true`. Blocks `issue`, `retire`, and all Token-2022 transfers on the mint.

```bash
# CLI
sss compliance halt   --mint <MINT>
sss compliance resume --mint <MINT>

# SDK
await client.halt(mint, guardianKp);
await client.resume(mint, guardianKp);
```

**On-chain check:** Every instruction that modifies supply includes:
```rust
require!(!config.halted, StablecoinError::Halted);
```

## Account Lock / Unlock

**Who:** `guardian` or `compliance` role  
**Effect:** Freezes/thaws a specific token account using the freeze authority (which is the config PDA).

```bash
sss lock --mint <MINT> --account <ATA>
sss lock --mint <MINT> --account <ATA> --unlock
```

> Locking does not affect the global halt state. A locked account cannot send or receive tokens even if the stablecoin is not halted.

## Denylist (Tier-2 / Tier-3)

**Who:** `compliance` role (dispatched to `sss-hook`)  
**Effect:** Blocks all transfers to or from a denylisted address at the hook level.

### Adding to Denylist

```bash
sss compliance deny --mint <MINT> --address <WALLET>
```

The `DenylistEntry` PDA is created: `["stbl_denylist", mint, address]`.

### Removing from Denylist

```bash
sss compliance undeny --mint <MINT> --address <WALLET>
```

The `DenylistEntry` PDA is closed (zeroed and rent reclaimed).

### Checking Denylist

```bash
# API
curl http://localhost:3001/v1/coins/<MINT>/denylist/<ADDRESS>

# SDK
const isDenied = await client.isDenied(mintPubkey, addressPubkey);
```

### Hook Enforcement

The hook checks **both** sender and receiver against the denylist on every transfer. The check is fail-closed: if the `HookConfig` account is missing or unreadable, the transfer is **blocked**.

## Confiscation (Tier-2 / Tier-3)

**Who:** `compliance` role  
**Effect:** Transfers tokens from a non-compliant account to the treasury without the holder's signature, using the permanent delegate extension.

```bash
sss compliance confiscate \
  --mint <MINT> \
  --source <SOURCE_ATA> \
  --treasury <TREASURY_ATA> \
  --amount 1000000000
```

**Important:** The `source` account must have a token balance ≥ `amount`. The confiscation is recorded in `total_seized` and emits a `TokensConfiscated` event.

### CPI Construction

Confiscation uses a **manual CPI** (not `anchor-spl`) because Token-2022 transfer hooks require `remaining_accounts`:

```rust
let ix = spl_token_2022::instruction::transfer_checked(
    &token_2022::ID,
    &source.key(),
    &mint.key(),
    &destination.key(),
    &config.key(),   // permanent delegate = config PDA
    &[],
    amount,
    mint.decimals,
)?;
// remaining_accounts: [extra_meta_list, hook_config, deny_entry_src, deny_entry_dst]
invoke_signed(&ix, &account_infos, &[&[CONFIG_SEED, mint.as_ref(), &[config.bump]]]);
```

## Audit Log

Every state-changing compliance operation increments `event_seq` and emits a typed event. The backend indexes all events via `getSignaturesForAddress` polling and stores them in Postgres.

**Query via API:**
```bash
# Paginated event log
curl "http://localhost:3001/v1/coins/<MINT>/events?kind=address_denied&limit=50"

# Specific event types
curl "http://localhost:3001/v1/coins/<MINT>/events?kind=tokens_confiscated"
```

## Emergency Response Playbook

### Scenario A: Suspicious activity detected

1. `sss lock --mint <MINT> --account <SUSPICIOUS_ATA>` — lock the specific account
2. Investigate on-chain activity via event log
3. If confirmed malicious: `sss compliance deny --address <WALLET>`
4. `sss compliance confiscate --source <SUSPICIOUS_ATA> ...`

### Scenario B: Critical vulnerability discovered

1. `sss compliance halt --mint <MINT>` — block all operations immediately
2. Coordinate with legal/compliance team
3. `sss compliance resume --mint <MINT>` — when safe to resume

### Scenario C: Compromised authority

1. Call `sss authority transfer --new-authority <NEW_KEY>` from the current authority
2. Have new authority call `sss authority accept`
3. Assign new role addresses via `sss roles set`
