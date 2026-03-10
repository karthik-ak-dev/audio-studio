# ──────────────────────────────────────────────
# Audio Recording Platform — Makefile
# ──────────────────────────────────────────────

.PHONY: help setup setup-api setup-web \
        local dynamo dynamo-table api web \
        build deploy deploy-stage deploy-prod \
        test test-api clean

# ─── Config ───────────────────────────────────
API_PORT       ?= 3001
WEB_PORT       ?= 5173
DYNAMO_PORT    ?= 8000
ENV            ?= dev
SAM_DIR        := infrastructure
API_DIR        := api
WEB_DIR        := web

help: ## Show available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

# ──────────────────────────────────────────────
# Setup
# ──────────────────────────────────────────────

setup: setup-api setup-web ## Install all dependencies

setup-api: ## Install API (Python) dependencies
	cd $(API_DIR) && python3 -m venv .venv && . .venv/bin/activate && pip install -r requirements-dev.txt

setup-web: ## Install Web (Node) dependencies
	cd $(WEB_DIR) && npm install

# ──────────────────────────────────────────────
# Local Development
# ──────────────────────────────────────────────

local: dynamo api web ## Start everything locally (dynamo + api + web)

dynamo: ## Start DynamoDB Local (Docker)
	@docker start dynamodb-local 2>/dev/null || \
		docker run -d -p $(DYNAMO_PORT):8000 --name dynamodb-local amazon/dynamodb-local
	@echo "DynamoDB Local running on port $(DYNAMO_PORT)"
	@$(MAKE) dynamo-table

dynamo-table: ## Create the sessions table in DynamoDB Local
	@aws dynamodb describe-table \
		--table-name audio-sessions-dev \
		--endpoint-url http://localhost:$(DYNAMO_PORT) > /dev/null 2>&1 || \
	aws dynamodb create-table \
		--table-name audio-sessions-dev \
		--attribute-definitions \
			AttributeName=session_id,AttributeType=S \
			AttributeName=status,AttributeType=S \
			AttributeName=created_at,AttributeType=S \
			AttributeName=host_user_id,AttributeType=S \
		--key-schema AttributeName=session_id,KeyType=HASH \
		--global-secondary-indexes \
			'[{"IndexName":"StatusIndex","KeySchema":[{"AttributeName":"status","KeyType":"HASH"},{"AttributeName":"created_at","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}},{"IndexName":"HostUserIndex","KeySchema":[{"AttributeName":"host_user_id","KeyType":"HASH"},{"AttributeName":"created_at","KeyType":"RANGE"}],"Projection":{"ProjectionType":"ALL"}}]' \
		--billing-mode PAY_PER_REQUEST \
		--endpoint-url http://localhost:$(DYNAMO_PORT) && \
	echo "Table audio-sessions-dev created" || true

api: ## Start API via SAM Local (Lambda emulator)
	cd $(SAM_DIR) && sam local start-api \
		--env-vars env.local.json \
		--port $(API_PORT) \
		--warm-containers EAGER

web: ## Start Web dev server (Vite)
	cd $(WEB_DIR) && VITE_API_BASE_URL=http://localhost:$(API_PORT) npm run dev

# ──────────────────────────────────────────────
# Build & Deploy
# ──────────────────────────────────────────────

build: ## SAM build
	cd $(SAM_DIR) && sam build

deploy: build ## Deploy to dev
	cd $(SAM_DIR) && sam deploy

deploy-stage: build ## Deploy to stage
	cd $(SAM_DIR) && sam deploy --config-env stage

deploy-prod: build ## Deploy to prod
	cd $(SAM_DIR) && sam deploy --config-env prod

# ──────────────────────────────────────────────
# Testing
# ──────────────────────────────────────────────

test: test-api ## Run all tests

test-api: ## Run API unit tests
	cd $(API_DIR) && . .venv/bin/activate && pytest -v

# ──────────────────────────────────────────────
# Cleanup
# ──────────────────────────────────────────────

clean: ## Stop and remove DynamoDB Local container
	docker stop dynamodb-local 2>/dev/null; docker rm dynamodb-local 2>/dev/null; echo "Cleaned up"


# Command	What it does
# make setup	Install Python + Node dependencies
# make local	Start everything — DynamoDB Local, SAM API, Vite dev server
# make dynamo	Start DynamoDB Local + create table
# make api	Start SAM Local API on port 3001
# make web	Start Vite dev server on port 5173
# make test	Run API unit tests
# make build	SAM build
# make deploy	Build + deploy to dev
# make deploy-stage	Build + deploy to stage
# make deploy-prod	Build + deploy to prod
# make clean	Stop & remove DynamoDB Local container
# make help	Show all targets