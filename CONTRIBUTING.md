# Contributing to SSS

Thank you for your interest in contributing to the Solana Stablecoin Standard.

## Development setup

```bash
git clone https://github.com/solanabr/solana-stablecoin-standard
cd solana-stablecoin-standard
make setup      # install all dependencies
make docker-up  # start Postgres + Redis
make migrate    # apply DB migrations
make seed       # seed dev data
make dev-backend &
make dev-frontend
```

Full prerequisites: [docs/OPERATIONS.md](docs/OPERATIONS.md)

## Branch strategy

| Branch    | Purpose                            |
|-----------|------------------------------------|
| `main`    | Production — requires 2 approvals  |
| `develop` | Integration branch for PRs         |
| `feat/*`  | Feature branches                   |
| `fix/*`   | Bug fixes                          |

All PRs target `develop`. `main` is merged from `develop` on release.

## Before opening a PR

```bash
make fmt    # auto-format
make lint   # no warnings
make test   # all tests pass
```

CI will run the same checks automatically.

## Commit messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(sdk): add forTier() shorthand constructor
fix(core): advance_seq() in register_minter handler
docs(api): document webhook signature verification
```

## Security

Please do **not** open public issues for security vulnerabilities.  
Instead, email `security@solanabr.com` with a description and PoC.  
We aim to respond within 48 hours and issue a patch within 7 days.

## Audit scope

The `programs/` directory is in scope for security review.  
Known limitations are documented in `docs/ARCHITECTURE.md`.

## Code style

- **Rust**: `cargo fmt` + `clippy -D warnings`
- **TypeScript**: Prettier + ESLint (`@typescript-eslint/recommended`)
- **Naming**: match on-chain identifiers exactly (see rename table in `README.md`)
