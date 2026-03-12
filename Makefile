# ══════════════════════════════════════════════════════════════════════════
# SSS Issuer Platform — Makefile
#
# Prerequisites:
#   - Rust + Cargo  (rustup.rs)
#   - Anchor CLI    (avm use latest)
#   - Node 22+      (nvm use 22)
#   - Docker + Compose
#   - Solana CLI    (solana install)
# ══════════════════════════════════════════════════════════════════════════

.DEFAULT_GOAL := help
.PHONY: help setup build test lint fmt clean docker-up docker-down \
        migrate seed dev-backend dev-frontend dev-tui \
        deploy-devnet anchor-build anchor-test sdk-build

# ── Colours ──────────────────────────────────────────────────────────────────
CYAN  := \033[36m
RESET := \033[0m

help: ## Show this help
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  $(CYAN)%-22s$(RESET) %s\n", $$1, $$2}'
	@echo ""

# ── One-time setup ────────────────────────────────────────────────────────────

setup: ## Install all dependencies (run once after clone)
	cp -n .env.example .env || true
	cd sdk      && npm ci
	cd cli      && npm ci
	cd backend  && npm ci
	cd app      && npm ci
	cd tui      && npm ci
	@echo "✅  Dependencies installed. Edit .env before running."

# ── Build ─────────────────────────────────────────────────────────────────────

build: anchor-build sdk-build ## Build Anchor programs + TypeScript SDK

anchor-build: ## Compile all Anchor programs
	anchor build

anchor-test: ## Run Anchor integration tests (requires localnet)
	anchor test

sdk-build: ## Build the TypeScript SDK
	cd sdk && npm run build

# ── Test ──────────────────────────────────────────────────────────────────────

test: ## Run all tests
	$(MAKE) test-rust
	$(MAKE) test-sdk
	$(MAKE) test-backend

test-rust: ## Run Rust unit tests only
	cargo test --workspace --exclude trident-tests

test-sdk: ## Run SDK unit tests
	cd sdk && npm test

test-backend: ## Run backend unit tests
	cd backend && npm test

test-fuzz: ## Run Trident fuzz tests (10 min limit)
	cd trident-tests && cargo trident fuzz run fuzz_issue_retire -- -max_total_time=600

# ── Lint & Format ─────────────────────────────────────────────────────────────

lint: ## Run all linters
	cargo clippy --workspace -- -D warnings
	cd sdk     && npm run lint
	cd cli     && npm run lint
	cd backend && npm run lint
	cd app     && npm run lint

fmt: ## Auto-format all code
	cargo fmt --all
	cd sdk     && npm run fmt 2>/dev/null || npx prettier --write src
	cd cli     && npm run fmt 2>/dev/null || npx prettier --write src
	cd backend && npm run fmt 2>/dev/null || npx prettier --write src
	cd app     && npm run fmt 2>/dev/null || npx prettier --write .

# ── Database ──────────────────────────────────────────────────────────────────

migrate: ## Run Prisma DB migrations
	cd backend && npx prisma migrate dev

migrate-prod: ## Apply migrations in production (no prompts)
	cd backend && npx prisma migrate deploy

seed: ## Seed the database with initial data
	cd backend && npx prisma db seed

prisma-studio: ## Open Prisma Studio (DB browser)
	cd backend && npx prisma studio

# ── Docker ────────────────────────────────────────────────────────────────────

docker-up: ## Start Postgres + Redis (dev dependencies)
	docker compose up -d postgres redis

docker-up-all: ## Start all services including backend + frontend
	docker compose up -d

docker-down: ## Stop all Docker services
	docker compose down

docker-logs: ## Tail all service logs
	docker compose logs -f

# ── Development servers ───────────────────────────────────────────────────────

dev-backend: ## Start the backend API server (hot-reload)
	cd backend && npm run dev

dev-frontend: ## Start the Next.js dev server
	cd app && npm run dev

dev-tui: ## Start the terminal UI
	cd tui && npm start

# ── Localnet ──────────────────────────────────────────────────────────────────

localnet-start: ## Start a local Solana validator with deployed programs
	solana-test-validator \
		--bpf-program $(SSS_CORE_ID) target/deploy/sss_core.so \
		--bpf-program $(SSS_HOOK_ID) target/deploy/sss_hook.so \
		--reset &

localnet-stop: ## Kill the local validator
	pkill -f solana-test-validator || true

# ── Deployment ────────────────────────────────────────────────────────────────

deploy-devnet: anchor-build ## Deploy programs to Devnet
	anchor deploy --provider.cluster devnet

# ── Cleanup ───────────────────────────────────────────────────────────────────

clean: ## Remove all build artifacts
	anchor clean
	rm -rf sdk/dist sdk/node_modules
	rm -rf cli/dist cli/node_modules
	rm -rf backend/dist backend/node_modules
	rm -rf app/.next app/node_modules
	rm -rf tui/dist tui/node_modules
