# Solana Stablecoin Standard (SSS)

A three-tier on-chain stablecoin framework built on Solana Token-2022 with
transfer hooks, permissioned minting, compliance controls, and institutional
co-sign governance.

## Tiers

| Tier | Preset | Key Features |
|------|--------|-------------|
| SSS-1 | **Minimal** | Permissioned mint/burn, two-step authority handover, halt/resume |
| SSS-2 | **Compliant** | SSS-1 + transfer hook, denylist, confiscation via permanent delegate |
| SSS-3 | **Institutional** | SSS-2 + co-sign gate, rolling rate window, timelocked handover |

SSS-3 is the primary differentiator of this implementation. A stablecoin
configured at `Tier::Institutional` requires every issuance to pass a
`M-of-N` co-signer approval before tokens are minted. No single key can
unilaterally issue at this tier.

## Programs

| Program | Description | Address |
|---------|-------------|---------|
| `sss-core` | Core issuance, roles, governance | `SSSTkn4G7RLuGDL1i5zKi2JoW6FpZ3wXCbQn9PmVkRzP` |
| `sss-hook` | Token-2022 transfer hook + denylist | `SSSHkQxWmNvEfHdTpY8cLrUaGb3xJ6nKo2Di4AlVsRqP` |

## Quick Start

```bash
# Install dependencies
pnpm install

# Build programs
anchor build

# Run tests (80 integration tests across 4 suites)
anchor test

# Deploy to devnet
anchor deploy --provider.cluster devnet
```

## Architecture

```
┌─────────────────────────────┐
│       sss-core              │
│  IssuanceConfig (PDA)       │
│  ┌────────┬───────────────┐ │
│  │ Tier-1 │ halt/resume   │ │
│  │        │ lock/unlock   │ │
│  │        │ issue/retire  │ │
│  ├────────┼───────────────┤ │
│  │ Tier-2 │ +confiscate   │ │
│  │        │ +hook CPI     │ │
│  ├────────┼───────────────┤ │
│  │ Tier-3 │ +co-sign gate │ │
│  │        │ +rate window  │ │
│  └────────┴───────────────┘ │
└──────────────┬──────────────┘
               │ CPI (Tier-2+)
┌──────────────▼──────────────┐
│       sss-hook              │
│  HookConfig + DenylistEntry │
│  execute_transfer guard     │
└─────────────────────────────┘
```

## PDA Seeds

| Account | Seeds | Program |
|---------|-------|---------|
| `IssuanceConfig` | `["stbl_config", mint]` | `sss-core` |
| `MinterAllowance` | `["stbl_minter", mint, wallet]` | `sss-core` |
| `MintProposal` | `["stbl_proposal", mint, seq_le]` | `sss-core` |
| `HookConfig` | `["stbl_hook_cfg", mint]` | `sss-hook` |
| `DenylistEntry` | `["stbl_denylist", mint, address]` | `sss-hook` |

## Roles

| Constant | Value | Assigned To | Permissions |
|----------|-------|-------------|-------------|
| `ROLE_ISSUER` | 0 | `issuer` field | register/revoke minters |
| `ROLE_GUARDIAN` | 1 | `guardian` field | halt/resume, lock/unlock |
| `ROLE_COMPLIANCE` | 2 | `compliance` field | lock/unlock, confiscate, denylist |

## SDK

```typescript
import { IssuerClientFactory } from "@sss/sdk";

const client = IssuerClientFactory.forTier("institutional", {
  provider, coreProgramId, hookProgramId
});

// Propose a co-sign-gated issuance
await client.proposeIssue({ amount, destination });
```

See [`docs/SDK.md`](docs/SDK.md) for full API reference.

## Tests

80 integration tests across 4 suites:

| Suite | Tests | Coverage |
|-------|-------|---------|
| `tests/tier1.ts` | 25 | Full Minimal lifecycle |
| `tests/tier2.ts` | 17 | Compliant + hook + denylist |
| `tests/tier3.ts` | 20 | Institutional + co-sign + rate window |
| `tests/access_control.ts` | 18 | Role enforcement for every instruction |

Plus fuzz suites via Trident:
- `fuzz_issue_retire` — random issue/retire sequences
- `fuzz_cosign_gate` — rogue-signer injection in co-sign flow

## Documentation

- [`docs/SSS-1.md`](docs/SSS-1.md) — Minimal tier specification
- [`docs/SSS-2.md`](docs/SSS-2.md) — Compliant tier specification
- [`docs/SSS-3.md`](docs/SSS-3.md) — Institutional tier specification
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Account model and design
- [`docs/COMPLIANCE.md`](docs/COMPLIANCE.md) — Denylist and confiscation guide
- [`docs/OPERATIONS.md`](docs/OPERATIONS.md) — Deployment and key rotation
- [`docs/API.md`](docs/API.md) — REST API reference
- [`docs/SDK.md`](docs/SDK.md) — TypeScript SDK guide

## License

MIT
