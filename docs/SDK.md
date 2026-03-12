# SDK Reference — `@sss/sdk`

## Installation

```bash
npm install @sss/sdk @coral-xyz/anchor @solana/web3.js @solana/spl-token
```

---

## Quick Start

```typescript
import { IssuerClient, CompliantClient, Tier } from "@sss/sdk";
import { AnchorProvider, Wallet } from "@coral-xyz/anchor";

const wallet   = new Wallet(keypair);
const provider = AnchorProvider.env();

// ── Tier-1: Minimal ──────────────────────────────────────────────────────────
const client = IssuerClient.forTier(Tier.Minimal, wallet);

const { mint } = await client.initialize(authority, {
  tier:     Tier.Minimal,
  name:     "My Stablecoin",
  symbol:   "MYS",
  uri:      "https://example.com/meta.json",
  decimals: 6,
});

// ── Tier-2: Compliant ────────────────────────────────────────────────────────
const client2 = IssuerClient.forTier(Tier.Compliant, wallet, {
  hookProgramId: HOOK_PROGRAM_ID,
});

const { mint: mint2 } = await client2.initialize(authority, {
  tier:          Tier.Compliant,
  name:          "Compliant USD",
  symbol:        "CUSD",
  uri:           "https://example.com/cusd.json",
  decimals:      6,
  hookProgramId: HOOK_PROGRAM_ID,
});

// ── Tier-3: Institutional ────────────────────────────────────────────────────
const client3 = IssuerClient.forTier(Tier.Institutional, wallet, {
  hookProgramId: HOOK_PROGRAM_ID,
});
```

---

## `IssuerClient`

Main client class. `CompliantClient` extends it with denylist and confiscation
operations.  Use `IssuerClient.forTier(tier, wallet, opts?)` to get the
appropriate subclass automatically.

| Method | Returns | Description |
|--------|---------|-------------|
| `IssuerClient.forTier(tier, wallet, opts?)` | `IssuerClient \| CompliantClient` | Tier-aware factory |
| `IssuerClient.minimal(wallet, opts?)` | `IssuerClient` | Tier-1 client |
| `IssuerClient.compliant(wallet, opts?)` | `CompliantClient` | Tier-2 client |
| `IssuerClient.institutional(wallet, opts?)` | `CompliantClient` | Tier-3 client |

---

## Client Options

```typescript
interface IssuerClientOptions {
  rpcUrl?:        string;                                   // Default: devnet
  commitment?:    "processed" | "confirmed" | "finalized"; // Default: "confirmed"
  skipPreflight?: boolean;                                  // Default: false
  coreProgramId?: PublicKey;                                // Override core program
  hookProgramId?: PublicKey;                                // Required for Tier-2/3
}
```

---

## `IssuerClient` Methods

### `initialize(payer, params)` → `{ mint, configPda, signature }`

Initialize a new stablecoin mint.

```typescript
const { mint, configPda, signature } = await client.initialize(authorityKp, {
  tier:     Tier.Minimal,
  name:     "USD Coin",
  symbol:   "USDC",
  uri:      "https://centre.io/usdc.json",
  decimals: 6,
});
```

### `issue(mint, minter, destination, amount)` → `TxResult`

Issue (mint) tokens. Tier-3 with `cosignThreshold > 0` must use the
co-sign proposal flow instead.

```typescript
await client.issue(
  mint.publicKey,
  minterKeypair,
  destinationAta,
  1_000_000n  // 1 token at 6 decimals
);
```

### `retire(mint, holder, source, amount)` → `TxResult`

Retire (burn) tokens from a holder's ATA.

### `lock(mint, operator, account)` → `TxResult`

Freeze a token account (Tier-2/3: compliance role; Tier-1: authority).

### `unlock(mint, operator, account)` → `TxResult`

Unfreeze a token account.

### `halt(mint, guardian)` → `TxResult`

Suspend all operations globally.

### `resume(mint, guardian)` → `TxResult`

Resume operations after a halt.

### `registerMinter(mint, issuer, wallet, cap)` → `TxResult`

Register a minter and set its lifetime issuance cap.

```typescript
await client.registerMinter(
  mint.publicKey, issuerKp, minterPublicKey, 10_000_000_000n
);
```

### `revokeMinter(mint, issuer, wallet)` → `TxResult`

Revoke a minter's allowance.

### `assignRole(mint, authority, role, newAddress)` → `TxResult`

Reassign a role address.

```typescript
await client.assignRole(
  mint.publicKey, authorityKp, ROLE_GUARDIAN, newGuardianPublicKey
);
```

`role` values: `ROLE_ISSUER` (0) | `ROLE_GUARDIAN` (1) | `ROLE_COMPLIANCE` (2)

### `initHandover(mint, authority, newAuthority)` → `TxResult`

Initiate a two-step authority handover. Tier-3 starts a 24-hour timelock.

### `acceptHandover(mint, pending)` → `TxResult`

Accept a pending authority handover (after timelock for Tier-3).

### `fetchConfig(mint)` → `Promise<IssuanceConfig>`

### `fetchAllowance(mint, wallet)` → `Promise<MinterAllowance>`

### `isHalted(mint)` → `Promise<boolean>`

---

## `CompliantClient` (Tier-2/3)

Extends `IssuerClient`. Adds denylist and confiscation.

### `deny(mint, compliance, address)` → `TxResult`

Add an address to the denylist (blocks all transfers).

### `clearDeny(mint, compliance, address)` → `TxResult`

Remove an address from the denylist.

### `isDenied(mint, address)` → `Promise<boolean>`

```typescript
const flagged = await client.isDenied(mint.publicKey, suspectAddress);
```

### `confiscate(mint, operator, source, treasury, amount)` → `TxResult`

Transfer tokens from a non-compliant account to the treasury.
Automatically resolves transfer hook extra-account-metas.

```typescript
await client.confiscate(
  mint.publicKey,
  complianceKp,
  frozenAccountAta,
  treasuryAta,
  amount
);
```

### `setWindow(mint, authority, windowSecs, windowCap)` → `TxResult` *(Tier-3)*

```typescript
// Set 1-hour window, max 1 M tokens/hr
await client.setWindow(mint.publicKey, authorityKp, 3600, 1_000_000_000_000n);
```

### `proposeIssue(mint, proposer, destination, amount)` → `ProposeResult` *(Tier-3)*

```typescript
const { seq, proposalPda } = await client.proposeIssue(
  mint.publicKey, minterKp, destinationAta, 500_000_000_000n
);
```

### `approveIssue(mint, cosigner, seq)` → `TxResult` *(Tier-3)*

### `executeIssue(mint, executor, seq)` → `TxResult` *(Tier-3)*

---

## PDA Helpers

```typescript
import {
  configPda,
  allowancePda,
  proposalPda,
  hookConfigPda,
  denylistEntryPda,
  extraMetaListPda,
} from "@sss/sdk";

const [cfgAddr, bump]  = configPda(mint, CORE_PROGRAM_ID);
const [allowAddr]      = allowancePda(mint, wallet, CORE_PROGRAM_ID);
const [propAddr]       = proposalPda(mint, seq, CORE_PROGRAM_ID);
const [entryAddr]      = denylistEntryPda(mint, addr, HOOK_PROGRAM_ID);
```

---

## Constants

```typescript
import {
  CORE_PROGRAM_ID,         // sss-core deployed address
  HOOK_PROGRAM_ID,         // sss-hook deployed address
  ROLE_ISSUER,             // 0 — manages minter allowances
  ROLE_GUARDIAN,           // 1 — halt / resume
  ROLE_COMPLIANCE,         // 2 — denylist + confiscate
  HANDOVER_LOCK_SECS,      // 86400 (24 h Tier-3 timelock)
} from "@sss/sdk";
```

---

## Error Handling

All SDK methods throw Anchor-style errors. Match on `error.message`:

```typescript
try {
  await client.issue(mint, minter, dest, amount);
} catch (e: any) {
  if (e.message.includes("AllowanceCapExceeded")) {
    console.error("Minter allowance exhausted");
  } else if (e.message.includes("Halted")) {
    console.error("Operations are halted");
  } else if (e.message.includes("WindowCapExceeded")) {
    console.error("Rate window cap — retry after window resets");
  }
}
```
