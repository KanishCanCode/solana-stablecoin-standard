# Changelog

All notable changes to this project are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

## [Unreleased]

## [1.0.0] — 2025-01-01

### Added — Programs

#### `sss-core`

- **Tier-3 (Institutional)** — first-class support via `initialize` params:
  - `cosign_threshold` + `cosigners[]` field in `IssuanceConfig`
  - `propose_issue` / `approve_issue` / `execute_issue` co-sign gate
  - Per-cosigner duplicate-vote bitmap (`votes_bitmap`)
  - Window-based rate limiting (`window_secs`, `window_cap`, `window_issued`, `window_reset_ts`)
  - `set_window` instruction (Tier-3 only)
- **`event_seq`** counter on `IssuanceConfig` — monotonically incremented by every
  state-mutating instruction, enabling cheap client-side change detection
- **`total_burned`** and **`total_seized`** accounting fields (separate from `total_issued`)
- **`init_handover` / `accept_handover`** two-step authority transfer with `HANDOVER_LOCK_SECS`
  timelock enforcement
- PDA seeds use `stbl_` prefix throughout for unambiguous on-chain footprint:
  - `stbl_config`, `stbl_minter`, `stbl_proposal`
- Halt enforcement is in `sss-core` before any CPI — the hook program never needs to read
  `IssuanceConfig.halted`

#### `sss-hook`

- Single-file architecture (`lib.rs`) — no sub-instruction directory
- `AddToDenylist` / `RemoveFromDenylist` instructions
- `DenylistEntry` PDA: seeds `[b"stbl_denylist", mint, address]`
- `HookConfig` PDA: seeds `[b"stbl_hook_cfg", mint]`
- `execute_transfer` validates both source and destination are not denied before allowing transfer
- Permanent-delegate pattern: `confiscate` bypasses the transfer hook entirely

### Added — SDK

- Three client classes: `IssuerClient` (Tier-1), `CompliantClient` (Tier-2), `InstitutionalClient` (Tier-3)
- `IssuerClientFactory.forTier()` factory
- PDA helpers: `configPda`, `allowancePda`, `proposalPda`, `hookConfigPda`, `denylistEntryPda`, `extraMetaListPda`
- Constant re-exports: `CORE_PROGRAM_ID`, `HOOK_PROGRAM_ID`, `ROLE_ISSUER`, `ROLE_GUARDIAN`, `ROLE_COMPLIANCE`

### Added — Backend

- PostgreSQL + Prisma schema (`IssuanceCoin`, `Transaction`, `DenylistEntry`, `Proposal`)
- Fastify v4 server with `requestId`, `auth`, `errors` plugins
- REST routes: `/v1/coins`, `/v1/compliance`, `/v1/proposals`
- `IndexerService` — on-chain event subscription, writes to Postgres
- `NotifierService` — webhook fan-out on state changes
- Docker-compose stack: `postgres`, `backend`, `frontend`

### Added — Frontend

- Next.js 14 app router under `app/`
- Panels: `OverviewPanel`, `MintersPanel`, `CompliancePanel`, `ProposalsPanel`
- `WalletProvider` wrapping Solana wallet-adapter
- `MintSelect` for multi-coin navigation

### Added — CLI

- yargs-based CLI (`sss-cli`)
- Commands: `issue`, `retire`, `freeze` (`lock`/`unlock`), `compliance`, `halt`, `roles`, `status`, `authority`, `proposal`

### Added — TUI

- Ink/React terminal UI
- Screens: `Overview`, `Minters`, `Compliance`, `Proposals`
- `StatusBar` component

### Added — Fuzz Tests (Trident)

- `fuzz_issue_retire` — random sequence of register/issue/retire/revoke
- `fuzz_cosign_gate` — random propose/approve/execute with rogue signers

### Added — Documentation

- `docs/SSS-1.md` — Minimal tier spec
- `docs/SSS-2.md` — Compliant tier spec  
- `docs/SSS-3.md` — Institutional tier spec (co-sign gate, rate windows, timelocked handover)
- `docs/ARCHITECTURE.md` — system design and account model
- `docs/COMPLIANCE.md` — denylist and confiscation operational guide
- `docs/OPERATIONS.md` — deployment, upgrade, and key rotation runbook
- `docs/API.md` — REST API reference
- `docs/SDK.md` — TypeScript SDK usage guide
