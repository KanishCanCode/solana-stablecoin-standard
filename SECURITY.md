# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | ✅        |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email `security@[your-domain]` with:
1. A description of the vulnerability
2. Steps to reproduce
3. Affected component(s) and version(s)
4. Potential impact

You will receive an acknowledgement within 48 hours and a full response
within 7 days. Critical findings affecting live deployments will be
patched within 72 hours.

## Threat Model

### In scope

- Arithmetic overflow / underflow in token accounting (`total_issued`, `window_issued`, minter caps)
- Unauthorised role escalation — any path that lets a caller acquire a role they were not assigned
- PDA collision or seed manipulation attacks
- Co-sign gate bypass — executing a proposal below threshold
- Rate window manipulation — resetting `window_reset_ts` without authority
- Re-entrancy through CPI into `sss-hook` during `confiscate`
- Transfer hook bypass that allows denied addresses to transact

### Out of scope

- Validator-level attacks or runtime exploits
- Solana core protocol bugs
- Social engineering of key holders

## Known Design Decisions

### Monotonic minter quota

`MinterAllowance.issued` is strictly monotone — retiring tokens does **not**
restore minter quota. This is intentional: allowing quota restoration would
let a single minter effectively print unbounded supply through repeated
issue+retire cycles. Operators wishing to increase a minter's effective
capacity must call `register_minter` with a higher `cap`.

### Halt scope

`halt` blocks `issue`, `retire`, and `lock`/`unlock`. It does **not** block
`confiscate` — a compliance officer must be able to act even during an
emergency pause.

### Hook seed values

PDA seeds use the `stbl_` prefix:
- `HookConfig`: `[b"stbl_hook_cfg", mint]`
- `DenylistEntry`: `[b"stbl_denylist", mint, address]`

These values are fixed at first deployment. Changing seeds would require
migrating all existing PDAs.

### Two-step authority handover

`init_handover` stores a `pending_authority`. The pending party must call
`accept_handover` to complete the transfer. This prevents authority being
transferred to an address whose private key is not held, which would
permanently lock the contract.

## Auditing

Fuzz testing is implemented via [Trident](https://github.com/Ackee-Blockchain/trident):
- `fuzz_issue_retire` — arbitrary register/issue/retire/revoke sequences
- `fuzz_cosign_gate` — arbitrary propose/approve/execute with rogue signers injected

Run with: `trident fuzz run fuzz_issue_retire`
