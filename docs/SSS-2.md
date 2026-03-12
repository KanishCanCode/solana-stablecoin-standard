# SSS-2 — Tier-2 Compliant Stablecoin

> SSS-2 builds on SSS-1 by adding a **transfer hook**, **permanent delegate**, and **default-frozen accounts**.

## Additional Token-2022 Extensions (beyond Tier-1)

| Extension | Purpose |
|-----------|---------|
| `TransferHook` | Routes all transfers through `sss-hook` for compliance checks |
| `PermanentDelegate` | `config` PDA holds permanent delegation — enables confiscation |
| `DefaultAccountState` | New ATAs default to `Frozen`; issuer must unlock before use |

## How the Transfer Hook Works

Every Token-2022 transfer on a Tier-2 mint invokes the `sss-hook` program.

```
Transfer instruction
  → Token-2022 runtime
    → sss-hook::execute (TransferHook interface)
      → check halted state    → DENY if halted
      → check sender denylist → DENY if found
      → check receiver denylist → DENY if found
      → pass (transfer proceeds)
```

The hook is **fail-closed**: if the hook config PDA is missing or unreadable, the transfer is blocked.

### Hook Accounts

The hook requires three **extra account metas** appended to every transfer CPI:

| Account | Seeds | Writable |
|---------|-------|----------|
| `ExtraAccountMetaList` | `["extra-account-metas", mint]` | No |
| `HookConfig` | `["stbl_hook_cfg", mint]` | No |
| `DenylistEntry(from)` | `["stbl_denylist", mint, from_key]` | No |
| `DenylistEntry(to)` | `["stbl_denylist", mint, to_key]` | No |

### Hook Initialization

After deploying a Tier-2 stablecoin, initialize the hook's extra-account-meta list:

```typescript
await hookProgram.methods.initializeExtraAccountMetaList()
  .accounts({ payer, extraAccountMetaList, hookConfig, mint, systemProgram })
  .rpc();
```

## Denylist

The denylist is enforced **at transfer time** by the hook. The `compliance` role manages entries via the hook program:

```typescript
// Deny an address
await hookProgram.methods.addToDenylist()
  .accounts({ payer, compliance, address, mint, denylistEntry, systemProgram })
  .rpc();

// Clear an address
await hookProgram.methods.removeFromDenylist()
  .accounts({ compliance, address, mint, denylistEntry })
  .rpc();
```

> **Note:** The internal PDA seed is `"stbl_denylist"` for wire-format stability. The SDK exposes this as `deny` / `clearDeny`.

## Confiscation

The permanent delegate extension allows `sss-core` to transfer tokens out of any account without the holder's signature. Implemented in `confiscate.rs` using a manual CPI because `anchor-spl` v0.32.1 drops `remaining_accounts`.

```
sss_core::confiscate(amount)
  → build spl_token_2022::transfer_checked instruction manually
  → pass hook extra accounts in remaining_accounts
  → invoke_signed with [CONFIG_SEED, mint, bump]
```

The `compliance` role may confiscate. The destination is the compliance treasury ATA.

## SDK Quick-Start

```typescript
import { IssuerClient, Tier } from "@sss/sdk";

const client = IssuerClient.forTier(Tier.Compliant, wallet, {
  hookProgramId: HOOK_PROGRAM_ID,
});

// Deploy Tier-2
const { mint } = await client.initialize(payer, {
  tier:          Tier.Compliant,
  name:          "RegFi USD",
  symbol:        "RFUSD",
  uri:           "https://issuer.com/rfusd.json",
  decimals:      6,
  hookProgramId: HOOK_PROGRAM_ID,
});

// Deny an address
await client.deny(mint.publicKey, complianceKp, badActorWallet);

// Confiscate
await client.confiscate(
  mint.publicKey, complianceKp, sourceAta, treasuryAta, 500_000_000n
);
```
