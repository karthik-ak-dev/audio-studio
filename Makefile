.PHONY: install build dev clean dev-server dev-web dev-infra dev-docker dev-docker-down build-server build-web build-processing build-docker

# ─── Install ───────────────────────────────────────────────────
install: install-server install-web

install-server:
	cd server && npm install

install-web:
	cd web && npm install

install-python:
	@if [ -f processing/requirements.txt ]; then \
		cd processing && pip install -r requirements.txt; \
	fi

# ─── Development (native — fast hot reload) ──────────────────
dev: dev-infra dev-server dev-web

dev-server:
	cd server && npm run dev

dev-web:
	cd web && npm run dev

dev-infra:
	cd tools/local-stack && docker compose up -d localstack redis

# ─── Development (Docker — production parity) ────────────────
dev-docker:
	cd tools/local-stack && docker compose --profile app up -d --build

dev-docker-down:
	cd tools/local-stack && docker compose --profile app down

dev-docker-logs:
	cd tools/local-stack && docker compose --profile app logs -f

# ─── Build ────────────────────────────────────────────────────
build: build-server build-web

build-server:
	cd server && npm run build

build-web:
	cd web && npm run build

build-processing:
	@echo "Python processing pipeline build — not yet implemented"

# ─── Docker ───────────────────────────────────────────────────
build-docker: build-docker-server build-docker-web

build-docker-server:
	docker build -f infra/docker/Dockerfile.server -t audio-studio-server ./server

build-docker-web:
	docker build -f infra/docker/Dockerfile.web -t audio-studio-web .

# ─── Clean ────────────────────────────────────────────────────
clean:
	cd server && npm run clean
	cd web && npm run clean
	@echo "Clean complete"

# ─── Infrastructure ──────────────────────────────────────────
infra-up:
	cd tools/local-stack && docker compose up -d localstack redis

infra-down:
	cd tools/local-stack && docker compose down

# ─── Type check ──────────────────────────────────────────────
typecheck:
	cd server && npm run typecheck
	cd web && npm run typecheck
