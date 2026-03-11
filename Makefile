# ──────────────────────────────────────────────
# Audio Recording Platform — Makefile
# ──────────────────────────────────────────────

.PHONY: help up down logs test lint clean

VENV := . .venv/bin/activate &&

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ──────────────────────────────────────────────
# Local Development (Docker Compose)
# ──────────────────────────────────────────────

up: ## Start all services (DynamoDB + Admin UI + API + Web)
	docker compose up --build

down: ## Stop all services
	docker compose down

logs: ## Tail logs (all or specific: make logs s=api)
	docker compose logs -f $(s)

# ──────────────────────────────────────────────
# Testing & Linting
# ──────────────────────────────────────────────

test: ## Run API unit tests
	$(VENV) cd api && pytest -v

lint: ## Run pylint on API code
	$(VENV) cd api && pylint app/

# ──────────────────────────────────────────────
# Cleanup
# ──────────────────────────────────────────────

clean: ## Stop and remove all Docker containers + volumes
	docker compose down -v 2>/dev/null; echo "Cleaned up"
