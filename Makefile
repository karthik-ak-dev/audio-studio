# ──────────────────────────────────────────────
# Audio Recording Platform — Makefile
# ──────────────────────────────────────────────

.PHONY: help up down logs test lint clean ffmpeg deploy-stage deploy-stage-fe deploy-prod deploy-prod-fe

VENV := . .venv/bin/activate &&
INFRA := cd infrastructure &&

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ──────────────────────────────────────────────
# Local Development (Docker Compose)
# ──────────────────────────────────────────────

up: ## Start all services (DynamoDB + Admin UI + API + Audio Merger + Web)
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
# Deploy Prerequisites
# ──────────────────────────────────────────────

ffmpeg: ## Download static ffmpeg binary for Lambda (one-time)
	bash audio-merger/bin/download-ffmpeg.sh

# ──────────────────────────────────────────────
# Stage Deployment
# ──────────────────────────────────────────────
# Usage:
#   make ffmpeg                  (one-time — downloads static ffmpeg for Lambda)
#   make deploy-stage DAILY_API_KEY=xxx    (DAILY_API_KEY = Daily.co API key)
#   make deploy-stage-fe         (build + push frontend to S3 + invalidate CF)

deploy-stage: ## Deploy backend to stage (DAILY_API_KEY=xxx [DAILY_WEBHOOK_SECRET=xxx])
	@test -f audio-merger/bin/ffmpeg || (echo "Error: run 'make ffmpeg' first" && exit 1)
	@test -n "$(DAILY_API_KEY)" || (echo "Error: DAILY_API_KEY required — make deploy-stage DAILY_API_KEY=your-daily-api-key" && exit 1)
	$(INFRA) sam build --config-env stage --use-container
	# Note: --parameter-overrides replaces samconfig.toml values entirely,
	# so Environment and DailyDomain must be repeated here.
	# DAILY_WEBHOOK_SECRET defaults to "none" which skips HMAC verification.
	$(INFRA) sam deploy --config-env stage --force-upload --parameter-overrides \
		"Environment=stage" \
		"DailyDomain=stage-kgen" \
		"DailyApiKey=$(DAILY_API_KEY)" \
		"DailyWebhookSecret=$(or $(DAILY_WEBHOOK_SECRET),none)"

deploy-stage-fe: ## Deploy frontend to stage
	@$(eval API_URL := $(shell aws cloudformation describe-stacks \
		--stack-name audio-studio-stage --region ap-south-1 \
		--query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text))
	@$(eval FE_BUCKET := $(shell aws cloudformation describe-stacks \
		--stack-name audio-studio-stage --region ap-south-1 \
		--query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" --output text))
	@$(eval CF_DIST := $(shell aws cloudformation describe-stacks \
		--stack-name audio-studio-stage --region ap-south-1 \
		--query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" --output text))
	cd web && VITE_API_BASE_URL=$(API_URL) npm run build
	aws s3 sync web/dist/ s3://$(FE_BUCKET)/ --delete
	aws cloudfront create-invalidation --distribution-id $(CF_DIST) --paths "/*"

# ──────────────────────────────────────────────
# Prod Deployment
# ──────────────────────────────────────────────

deploy-prod: ## Deploy backend to prod (DAILY_API_KEY=xxx [DAILY_WEBHOOK_SECRET=xxx])
	@test -f audio-merger/bin/ffmpeg || (echo "Error: run 'make ffmpeg' first" && exit 1)
	@test -n "$(DAILY_API_KEY)" || (echo "Error: DAILY_API_KEY required — make deploy-prod DAILY_API_KEY=your-daily-api-key" && exit 1)
	$(INFRA) sam build --config-env prod --use-container
	# Note: --parameter-overrides replaces samconfig.toml values entirely,
	# so Environment and DailyDomain must be repeated here.
	# DAILY_WEBHOOK_SECRET defaults to "none" which skips HMAC verification.
	$(INFRA) sam deploy --config-env prod --force-upload --parameter-overrides \
		"Environment=prod" \
		"DailyDomain=ak-kgen" \
		"DailyApiKey=$(DAILY_API_KEY)" \
		"DailyWebhookSecret=$(or $(DAILY_WEBHOOK_SECRET),none)"

deploy-prod-fe: ## Deploy frontend to prod
	@$(eval API_URL := $(shell aws cloudformation describe-stacks \
		--stack-name audio-studio-prod --region ap-south-1 \
		--query "Stacks[0].Outputs[?OutputKey=='ApiUrl'].OutputValue" --output text))
	@$(eval FE_BUCKET := $(shell aws cloudformation describe-stacks \
		--stack-name audio-studio-prod --region ap-south-1 \
		--query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" --output text))
	@$(eval CF_DIST := $(shell aws cloudformation describe-stacks \
		--stack-name audio-studio-prod --region ap-south-1 \
		--query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" --output text))
	cd web && VITE_API_BASE_URL=$(API_URL) npm run build
	aws s3 sync web/dist/ s3://$(FE_BUCKET)/ --delete
	aws cloudfront create-invalidation --distribution-id $(CF_DIST) --paths "/*"

# ──────────────────────────────────────────────
# Cleanup
# ──────────────────────────────────────────────

clean: ## Stop and remove all Docker containers + volumes
	docker compose down -v 2>/dev/null; echo "Cleaned up"


# One-time
# make ffmpeg
# Deploy backend (replace placeholders with your actual values)
# make deploy-stage DAILY_API_KEY=<your-daily-api-key> DAILY_WEBHOOK_SECRET=<your-webhook-secret>
# Deploy frontend
# make deploy-stage-fe
