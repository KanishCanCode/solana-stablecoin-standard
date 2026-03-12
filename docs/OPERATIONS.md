# Operations Guide — SSS Operator Runbook

## Prerequisites

```bash
# Solana CLI
sh -c "$(curl -sSfL https://release.anza.xyz/v2.3.0/install)"

# Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor anchor-cli --tag v0.32.1

# SDK / CLI
make setup
```

---

## Deploying a New Stablecoin

### Tier-1 (Minimal)

```bash
# 1. Build and deploy programs
anchor build
anchor deploy --provider.cluster devnet

# 2. Initialize via CLI
sss init \
  --name    "My Stablecoin" \
  --symbol  "MYS" \
  --uri     "https://issuer.com/meta.json" \
  --decimals 6 \
  --tier    minimal \
  --keypair /path/to/authority.json

# Output: Mint: <MINT_ADDRESS>  Config: <CONFIG_PDA>
```

### Tier-2 (Compliant)

```bash
sss init \
  --name         "Compliant USD" \
  --symbol       "CUSD" \
  --uri          "https://issuer.com/cusd.json" \
  --decimals     6 \
  --tier         compliant \
  --hook-program SSSHkQxWmNvEfHdTpY8cLrUaGb3xJ6nKo2Di4AlVsRqP \
  --keypair      /path/to/authority.json

# After init: initialize the hook extra-account-meta list
sss init-hook --mint <MINT_ADDRESS> --keypair /path/to/authority.json
```

### Tier-3 (Institutional)

```bash
sss init \
  --tier              institutional \
  --name              "Institutional USD" \
  --symbol            "IUSD" \
  --uri               "https://issuer.com/iusd.json" \
  --decimals          6 \
  --window-secs       3600 \
  --window-cap        1000000000000 \
  --cosign-threshold  2 \
  --cosigners         "<SIGNER1>,<SIGNER2>,<SIGNER3>" \
  --keypair           /path/to/authority.json
```

---

## Common Operations

### Issuance

```bash
# Register a minter with a 1 M token lifetime cap
sss minter register \
  --mint    <MINT> \
  --wallet  <MINTER_PUBKEY> \
  --cap     1000000000000 \
  --keypair /path/to/issuer.json

# Issue 100 tokens (Tier-1/2, or Tier-3 without cosign gate)
sss issue \
  --mint        <MINT> \
  --destination <DEST_ATA> \
  --amount      100000000 \
  --keypair     /path/to/minter.json

# Tier-3: propose → approve → execute
sss issue propose \
  --mint        <MINT> \
  --destination <DEST_ATA> \
  --amount      500000000 \
  --keypair     /path/to/minter.json
# Output: proposal seq: 42

sss issue approve --mint <MINT> --proposal 42 --keypair /path/to/signer1.json
sss issue approve --mint <MINT> --proposal 42 --keypair /path/to/signer2.json
sss issue execute --mint <MINT> --proposal 42 --keypair /path/to/signer1.json
```

### Emergency Response

```bash
# Halt all operations immediately
sss halt --mint <MINT> --keypair /path/to/guardian.json

# Check current state
sss status --mint <MINT> --output json

# Lock a specific account
sss lock --mint <MINT> --account <TOKEN_ACCOUNT> --keypair /path/to/compliance.json

# Confiscate funds from non-compliant account (Tier-2/3)
sss confiscate \
  --mint     <MINT> \
  --source   <FROZEN_ATA> \
  --treasury <TREASURY_ATA> \
  --amount   1000000000 \
  --keypair  /path/to/compliance.json
```

### Compliance Management (Tier-2/3)

```bash
# Add to denylist
sss denylist add \
  --mint    <MINT> \
  --address <WALLET_ADDRESS> \
  --keypair /path/to/compliance.json

# Remove from denylist
sss denylist remove \
  --mint    <MINT> \
  --address <WALLET_ADDRESS> \
  --keypair /path/to/compliance.json

# Check if address is denied
sss denylist check --mint <MINT> --address <WALLET_ADDRESS>
```

### Authority Rotation

```bash
# Initiate handover (Tier-3: 24 h timelock starts)
sss authority handover \
  --mint          <MINT> \
  --new-authority <NEW_AUTHORITY_PUBKEY> \
  --keypair       /path/to/current_authority.json

# Accept (after timelock for Tier-3)
sss authority accept \
  --mint    <MINT> \
  --keypair /path/to/new_authority.json

# Reassign a role
sss roles assign \
  --mint        <MINT> \
  --role        guardian \
  --new-address <NEW_GUARDIAN> \
  --keypair     /path/to/authority.json
```

### Monitoring

```bash
# Full state dump
sss status --mint <MINT> --output table

# Sample output:
# ┌──────────────────────┬──────────────────────────────────────────────────┐
# │ Field                │ Value                                             │
# ├──────────────────────┼──────────────────────────────────────────────────┤
# │ Mint                 │ 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU   │
# │ Tier                 │ Institutional                                     │
# │ Halted               │ false                                             │
# │ Issuer               │ 3yZe7d...                                         │
# │ Guardian             │ 4aWf2c...                                         │
# │ Total Issued         │ 1,000,000.000000                                  │
# │ Total Retired        │ 100,000.000000                                    │
# │ Total Confiscated    │ 0.000000                                          │
# │ Window (s)           │ 3600                                              │
# │ Window Cap           │ 1,000,000.000000 / window                        │
# │ Window Issued        │ 500,000.000000                                    │
# │ Co-sign Threshold    │ 2-of-3                                            │
# └──────────────────────┴──────────────────────────────────────────────────┘

# Monitor events in real-time
sss events --mint <MINT> --follow
```

---

## Incident Response Checklist

### Suspected Minter Key Compromise

1. `sss minter revoke --mint <MINT> --wallet <COMPROMISED> --keypair <ISSUER_KEY>`
2. Issue replacement key: `sss minter register --mint <MINT> --wallet <NEW> --cap <AMOUNT>`
3. Audit recent issuances: `sss events --mint <MINT> --filter issued --since <TIMESTAMP>`

### Suspected Authority Key Compromise (Tier-3)

1. Initiate handover: `sss authority handover --mint <MINT> --new-authority <SAFE_KEY> --keypair <OLD_KEY>`
2. **24-hour window to cancel**: `sss authority cancel --mint <MINT> --keypair <OLD_KEY>`
3. Monitor `handover_initiated` events via the event stream

### OFAC / Regulatory Freeze Order

1. `sss denylist add --mint <MINT> --address <WALLET>`
2. `sss lock --mint <MINT> --account <TOKEN_ACCOUNT>`
3. `sss confiscate ...` (if order requires fund recovery)
4. All actions emit indexed on-chain events — automatic audit trail

---

## Backend Services

```bash
cd backend
cp .env.example .env
# Edit .env: SOLANA_RPC_URL, JWT_SECRET, DATABASE_URL

make docker-up    # start Postgres + Redis
make migrate      # run DB migrations
make seed         # create dev API key (printed once)
make dev-backend  # start API server on :3001

# Docs: http://localhost:3001/docs
```

### REST Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/v1/auth/token` | API key | Issue JWT |
| `GET` | `/v1/coins` | — | List indexed stablecoins |
| `GET` | `/v1/coins/:mint` | — | Stablecoin details + minters + events |
| `GET` | `/v1/coins/:mint/denylist` | — | List denied addresses |
| `GET` | `/v1/coins/:mint/denylist/:address` | — | Check one address |
| `GET` | `/v1/coins/:mint/events` | — | Paginated event log |
| `GET` | `/v1/coins/:mint/proposals` | — | List co-sign proposals |
| `GET` | `/v1/coins/:mint/proposals/:id` | — | Proposal details + votes |
| `POST` | `/v1/coins/:mint/webhooks` | JWT | Register webhook |
