# SSS REST API Reference

Base URL: `http://localhost:3001`
Interactive docs: `http://localhost:3001/docs` (Swagger UI)

---

## Authentication

Obtain a JWT first, then include it as a bearer token on protected routes.

### `POST /v1/auth/token`

**Body:**
```json
{ "apiKey": "sss_dev_<your-key>" }
```

**Response:**
```json
{
  "token":     "<jwt>",
  "expiresIn": 86400,
  "tokenType": "Bearer"
}
```

Protected routes require:
```
Authorization: Bearer <token>
```

---

## Coins

### `GET /v1/coins`

Returns all indexed stablecoins.

**Response:**
```json
{
  "data": [
    {
      "mint":        "SSSTkn4G7...",
      "authority":   "3yZe7d...",
      "tier":        1,
      "name":        "ACME USD",
      "symbol":      "AUSD",
      "decimals":    6,
      "totalIssued": "500000000",
      "totalBurned": "100000000",
      "totalSeized": "0",
      "halted":      false,
      "createdAt":   "2025-01-01T00:00:00.000Z",
      "_count": { "minters": 3 }
    }
  ]
}
```


### `GET /v1/coins/:mint`

Returns a single stablecoin with minters and recent events.

**Response:**
```json
{
  "data": {
    "mint":             "SSSTkn4G7...",
    "authority":        "3yZe7d...",
    "issuer":           "4aWf2c...",
    "guardian":         "5bXg3d...",
    "compliance":       "6cYh4e...",
    "tier":             1,
    "name":             "ACME USD",
    "symbol":           "AUSD",
    "decimals":         6,
    "totalIssued":      "500000000",
    "totalBurned":      "100000000",
    "totalSeized":      "0",
    "eventSeq":         "42",
    "windowSecs":       "0",
    "windowCap":        "0",
    "windowIssued":     "0",
    "cosignThreshold":  0,
    "halted":           false,
    "minters": [
      {
        "wallet":        "7dZi5f...",
        "cap":           "10000000000",
        "issued":        "500000000",
        "enabled":       true,
        "registeredAt":  "2025-01-01T00:00:00.000Z"
      }
    ],
    "events": [
      {
        "kind":      "issued",
        "seq":       "1",
        "slot":      "123456789",
        "signature": "5xyz...",
        "indexedAt": "2025-01-01T00:00:00.000Z"
      }
    ]
  }
}
```

### `POST /v1/coins/:mint/webhooks` 🔒

Register a webhook for event notifications.

**Body:**
```json
{
  "url":         "https://your-server.example/webhooks/sss",
  "secret":      "at-least-16-char-secret",
  "eventFilter": ["issued", "denied"]
}
```

**Webhook payload** (delivered via `POST` with HMAC-SHA256 signature):
```json
{
  "event":   "issued",
  "mint":    "SSSTkn4G7...",
  "slot":    "123456789",
  "payload": { "raw": "<base64>" }
}
```

**Signature headers:**
```
X-SSS-Timestamp: <unix_ms>
X-SSS-Signature: v1=<hmac_sha256(secret, "{timestamp}.{body}")>
X-SSS-Event:     issued
```

---

## Compliance

### `GET /v1/coins/:mint/denylist`

Returns all denied addresses (active denylist entries).

### `GET /v1/coins/:mint/denylist/:address`

Check whether a specific address is denied.

**Response:**
```json
{
  "data": {
    "address": "7dZi5f...",
    "denied":  true,
    "by":      "<compliance_wallet>",
    "since":   "2025-06-01T12:00:00.000Z"
  }
}
```

### `GET /v1/coins/:mint/events`

Paginated compliance event log.

**Query params:**
- `kind` — filter by event kind (e.g. `denied`, `confiscated`, `issued`)
- `page` — page number (default 1)
- `limit` — items per page (1–200, default 50)
- `before` — only events with seq < this value

**Event kind values:**
`deployed` | `issued` | `retired` | `confiscated` | `locked` | `unlocked` |
`halted` | `resumed` | `denied` | `cleared` | `role_assigned` |
`handover_initiated` | `handover_complete` | `minter_registered` | `minter_revoked` |
`window_updated` | `issue_proposed` | `issue_vote_cast` | `issue_executed`

---

## Proposals

### `GET /v1/coins/:mint/proposals`

List co-sign issuance proposals.

**Query params:**
- `status` — `pending` | `ready` | `executed` | `expired`
- `page`, `limit`

**Response:**
```json
{
  "data": [
    {
      "id":           "cuid...",
      "proposalSeq":  "3",
      "proposer":     "...",
      "recipient":    "...",
      "amount":       "500000000",
      "voteCount":    2,
      "threshold":    2,
      "executed":     false,
      "expiresAt":    "2025-07-01T00:00:00.000Z",
      "status":       "ready"
    }
  ],
  "meta": { "page": 1, "limit": 20, "total": 1, "pages": 1 }
}
```


### `GET /v1/coins/:mint/proposals/:id`

Get a single proposal with full vote log.

```json
{
  "data": {
    "id":          "cuid...",
    "proposalSeq": "3",
    "votes": [
      { "voter": "...", "votedAt": "2025-07-01T00:00:00.000Z" }
    ]
  }
}
```

---

## Health

### `GET /healthz`

Returns server health. No auth required.

**Response:**
```json
{ "status": "ok", "version": "1.0.0", "ts": "2025-01-01T00:00:00.000Z" }
```

---

## Error Responses

All errors follow a uniform shape:

```json
{
  "error":     "Human-readable message",
  "code":      "MACHINE_READABLE_CODE",
  "requestId": "abc123-def4"
}
```

| HTTP | Code | Meaning |
|------|------|---------|
| 400 | `VALIDATION_ERROR` | Invalid request body or params |
| 401 | `UNAUTHORIZED` | Missing or invalid JWT |
| 403 | `FORBIDDEN` | Valid JWT but insufficient scope |
| 404 | `NOT_FOUND` | Resource does not exist |
| 409 | `CONFLICT` | Duplicate resource |
| 429 | `RATE_LIMITED` | Exceeded 200 req/min |
| 500 | `INTERNAL_ERROR` | Unexpected server error |
