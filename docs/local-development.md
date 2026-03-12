# Local Development Guide

## Prerequisites

- **Docker** — all services run via Docker Compose
- **Daily.co account** — API key from https://dashboard.daily.co → Developers → API Keys. Update the key directly in `docker-compose.yml` → `api` → `DAILY_API_KEY`

## Quick Start

```bash
# 1. Update your Daily.co API key in docker-compose.yml → api → DAILY_API_KEY (one-time)

# 2. Start everything
make up
```

Open http://localhost:5173 in your browser.

## Services

| Service | Port | URL |
|---------|------|-----|
| Web (Vite) | 5173 | http://localhost:5173 |
| API (FastAPI) | 3001 | http://localhost:3001 |
| Audio Merger | 3002 | http://localhost:3002 |
| DynamoDB Local | 8000 | - |
| DynamoDB Admin UI | 8001 | http://localhost:8001 |

## Commands

```bash
make up          # Start all services
make down        # Stop all services
make logs        # Tail all logs
make logs s=api  # Tail API logs only
make test        # Run API unit tests
make lint        # Run pylint on API code
make clean       # Stop + remove containers and volumes
```

## Hot Reload

Both API and Web have hot reload via volume mounts:
- Edit `api/app/` → API restarts automatically
- Edit `web/src/` → Vite HMR updates the browser

## Testing the Flow

1. Open http://localhost:5173
2. Fill in host name + guest name → click "Create Session"
3. You'll land on the AudioRoom page
4. Copy the guest invite link → open in incognito/another browser
5. Guest clicks "Join Session"
6. Both participants are in the room → host sees "Start Recording"
7. Host clicks "Start Recording" → recording begins
8. Talk for a bit → click "Stop Recording"
9. Lands on the complete page

## Verify via API

```bash
# Health check
curl http://localhost:3001/health

# Create a session
curl -X POST http://localhost:3001/sessions \
  -H "Content-Type: application/json" \
  -d '{"host_name": "Alice", "guest_name": "Bob", "host_user_id": "host-123"}'

# Get session status
curl http://localhost:3001/sessions/<session_id>
```

## Inspect DynamoDB

Open http://localhost:8001 for the DynamoDB Admin UI, or use the CLI:

```bash
aws dynamodb scan \
  --table-name audio-sessions-dev \
  --endpoint-url http://localhost:8000
```

## AWS Credentials

The audio-merger container needs real AWS credentials to access S3 (download raw tracks, upload processed WAVs). It mounts your host `~/.aws` directory read-only:

```yaml
volumes:
  - ~/.aws:/root/.aws:ro
```

Ensure you have valid credentials configured (`aws configure`). DynamoDB is local — no real AWS access needed for that.

## What Works Locally vs What Needs Stage

| Feature | Local | Needs Stage |
|---------|-------|-------------|
| Session CRUD | Yes | - |
| WebRTC audio call | Yes | - |
| Join/Leave tracking | Yes | - |
| Start/Stop/Pause/Resume | Yes | - |
| UI flow end-to-end | Yes | - |
| Webhooks (reconciliation) | With ngrok | - |
| S3 recording upload | Yes* | - |
| Audio merger (WAV output) | Yes** | - |
| `processing → completed` | Yes** | - |

*Recordings go to the existing S3 bucket (configured with Daily.co).

**Audio merger runs as a local HTTP server (port 3002). When the API receives the `recording.ready-to-download` webhook, it calls the audio-merger container directly via HTTP instead of invoking a Lambda.

## Session State Lifecycle

```
created → waiting_for_guest → ready → recording ⇄ paused → processing → completed
                                                           ↘ error (webhook only)
```

| Step | User Action | API Endpoint | Status | participant_count |
|------|-------------|-------------|--------|-------------------|
| 1 | Host creates session | `POST /sessions/` | `created` | 0 |
| 2 | Host joins room | `POST /sessions/{id}/join` | `waiting_for_guest` | 1 |
| 3 | Guest joins room | `POST /sessions/{id}/join` | `ready` | 2 |
| 4 | Host starts recording | `POST /sessions/{id}/start` | `recording` | 2 |
| 5 | Host pauses (optional) | `POST /sessions/{id}/pause` | `paused` | 2 |
| 6 | Host resumes (optional) | `POST /sessions/{id}/resume` | `recording` | 2 |
| 7 | Host stops recording | `POST /sessions/{id}/stop` | `processing` | 2 |
| 8 | Audio merger | Lambda / local HTTP | `completed` | 2 |
