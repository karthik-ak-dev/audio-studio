# Audio Studio — Production Architecture

## Core Principle: Server-Driven UI

```
┌──────────────────────────────────────────────────────────────────────┐
│                        GOLDEN RULE                                   │
│                                                                      │
│   DynamoDB is the SINGLE SOURCE OF TRUTH for all session state.      │
│   The UI renders from server state, NEVER from SDK state alone.      │
│   The Daily.co SDK is a TRANSPORT LAYER — it carries audio and       │
│   emits events, but it does NOT own state.                           │
│                                                                      │
│   Pattern for EVERY user action:                                     │
│     1. User clicks button                                            │
│     2. FE calls backend API (blocking, waits for response)           │
│     3. Backend validates, calls Daily.co if needed, writes DynamoDB  │
│     4. Backend returns new status                                    │
│     5. FE updates UI from the response                               │
│                                                                      │
│   Pattern for EVERY SDK event:                                       │
│     1. Daily SDK fires event (participant-joined, recording-started) │
│     2. FE does NOT update session state from this event              │
│     3. FE triggers an immediate server poll                          │
│     4. FE updates UI from the poll response (server state)           │
│                                                                      │
│   The SDK is used ONLY for:                                          │
│     - Audio transport (WebRTC)                                       │
│     - Local-only state: mute toggle, mic level, network quality      │
│     - Triggering "something changed" → poll server                   │
│                                                                      │
│   This means: if a user refreshes the page, closes the tab, and     │
│   reopens it — the UI rebuilds entirely from server state.           │
│   No SDK state is needed to render the correct UI.                   │
└──────────────────────────────────────────────────────────────────────┘
```

## Second Principle: Leave = Pause, Only "End Session" = Terminal

```
┌──────────────────────────────────────────────────────────────────────┐
│                      LEAVE vs END                                    │
│                                                                      │
│   Leaving the page (tab close, navigate away, browser crash,         │
│   network drop) is NEVER terminal. It auto-pauses the session        │
│   (recording keeps running) and the session remains recoverable.     │
│   Either participant can rejoin and resume.                           │
│                                                                      │
│   ONLY the explicit "End Session" button (host-only) moves the       │
│   session to processing. This is the ONLY terminal user action.      │
│                                                                      │
│   Why: Users accidentally close tabs, browsers crash, networks       │
│   drop. A 45-minute recording should not be lost because someone     │
│   hit Cmd+W. The Daily.co room stays alive (2hr TTL), tokens         │
│   remain valid, and participants can rejoin at any time.             │
│                                                                      │
│   Cleanup: Sessions abandoned in paused state are cleaned up by      │
│   a TTL-based mechanism — Daily room expires after 2 hours,          │
│   DynamoDB record expires after 30 days.                             │
└──────────────────────────────────────────────────────────────────────┘
```

## Third Principle: No sendBeacon, Webhook Handles All Involuntary Disconnects

```
┌──────────────────────────────────────────────────────────────────────┐
│                 DISCONNECT HANDLING                                   │
│                                                                      │
│   We do NOT use sendBeacon or beforeunload for leave detection.      │
│   Reason: beforeunload fires on page REFRESH too, and we cannot      │
│   distinguish refresh from tab close in the browser.                 │
│                                                                      │
│   Only TWO ways a participant leaves the session:                    │
│                                                                      │
│   1. EXPLICIT: User clicks "Leave Session" button                    │
│      → FE calls POST /leave (instant logical auto-pause if recording)│
│        (DynamoDB status only — Daily recording keeps running)        │
│                                                                      │
│   2. INVOLUNTARY: Everything else (tab close, browser close,         │
│      crash, network drop, device shutdown)                           │
│      → Daily.co detects WebRTC heartbeat timeout (~10-30s)           │
│      → Daily fires participant.left webhook                          │
│      → Backend logical auto-pause (DynamoDB only, recording runs)    │
│                                                                      │
│   REFRESH is handled differently:                                    │
│      → Old connection dies, new connection joins within ~3s          │
│      → Backend detects stale connection via connection map            │
│      → Webhook for old connection is ignored (stale)                 │
│      → No pause, no disruption, recording continues                  │
│                                                                      │
│   Tradeoff: Tab close takes 10-30s to detect (vs instant with        │
│   sendBeacon). This is acceptable — the recording audio is saved     │
│   up to the disconnect point, and 10-30s of one-sided audio is       │
│   trivially trimmed in post-processing.                              │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Architecture Layers

```
┌─────────────────────────────────────────────────────────┐
│  FRONTEND (React)                                       │
│  ┌───────────────┐  ┌──────────────┐  ┌─────────────┐  │
│  │ SessionContext │  │  useDaily()  │  │ useSession  │  │
│  │ (server state)│  │ (SDK/audio)  │  │   Api()     │  │
│  │               │  │              │  │             │  │
│  │ status        │  │ isJoined     │  │ pollSession │  │
│  │ participants  │←─│ isMuted      │  │ (no loading)│  │
│  │ recording_*   │  │ micLevel     │  │             │  │
│  │ hostName      │  │ networkQual  │  │ actions     │  │
│  │ guestName     │  │ localPId     │  │ (loading)   │  │
│  │ isHost        │  │              │  │             │  │
│  └──────┬────────┘  └──────┬───────┘  └──────┬──────┘  │
│         │UI RENDERS        │AUDIO             │API      │
│         │FROM THIS         │TRANSPORT         │CALLS    │
│         │                  │ONLY              │         │
└─────────┼──────────────────┼──────────────────┼─────────┘
          │                  │                  │
          │ polls GET        │ WebRTC           │ POST /start
          │ /sessions/{id}   │                  │ POST /pause
          │                  │                  │ POST /join
          │                  │                  │ etc.
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│  BACKEND (FastAPI)                                      │
│  ┌───────────────────────────────────────────────────┐  │
│  │ session_service.py — all business logic here      │  │
│  │                                                   │  │
│  │ FE endpoints:     Webhook handlers:               │  │
│  │  join_session()    on_participant_joined()         │  │
│  │  leave_session()   on_participant_left()           │  │
│  │  start_recording() on_recording_ready_to_download()│  │
│  │  pause_session()   on_recording_error()            │  │
│  │  resume_session()                                  │  │
│  │  end_session()                                    │  │
│  │                                                   │  │
│  │  BOTH use the SAME idempotent DynamoDB operations │  │
│  └────────────┬──────────────────────┬───────────────┘  │
│               │                      │                  │
│               ▼                      ▼                  │
│  ┌────────────────────┐  ┌───────────────────────┐      │
│  │ session_repo.py    │  │ daily_client.py       │      │
│  │ (DynamoDB CRUD)    │  │ (Daily.co REST API)   │      │
│  │                    │  │                       │      │
│  │ add_participant()  │  │ create_room()         │      │
│  │ remove_participant │  │ create_token()        │      │
│  │ update_status()    │  │ start_recording()     │      │
│  │ conditional_update │  │ stop_recording()      │      │
│  └────────┬───────────┘  └───────────────────────┘      │
│           │                                             │
└───────────┼─────────────────────────────────────────────┘
            │
            ▼
┌─────────────────────────────────────────────────────────┐
│  DynamoDB — SINGLE SOURCE OF TRUTH                      │
│                                                         │
│  session_id (PK)                                        │
│  status: created|waiting_for_guest|ready|recording|     │
│          paused|processing|completed|error               │
│  version: Number                  ← optimistic locking  │
│                                                         │
│  ── Participant Tracking (3 fields) ──                  │
│                                                         │
│  active_participants: Set<String>                       │
│    e.g. {"host-174...", "guest-abc..."}                  │
│    User IDs (stable across reconnections)               │
│    ADD/DELETE are atomic + idempotent                    │
│    Used for: count, business logic decisions             │
│                                                         │
│  participant_connections: Map<String,String>             │
│    e.g. {"host-174...": "daily-sess-abc123",            │
│          "guest-abc...": "daily-sess-def456"}            │
│    User ID → latest Daily session_id (connection ID)    │
│    (Daily's session_id = per-connection ID, changes     │
│     on every reconnect/refresh. NOT our session_id.)    │
│    Overwritten on each join (reconnection updates it)   │
│    Used for: stale webhook detection on refresh         │
│                                                         │
│  participants: Map<String,String>                       │
│    e.g. {"host-174...": "Alice",                        │
│          "guest-abc...": "Bob"}                          │
│    User ID → display name (roster)                      │
│    Write-once, never removed                            │
│    Used for: showing names (even after disconnect)      │
│                                                         │
│  ── Recording State ──                                  │
│  recording_id                                           │
│  recording_started_at, recording_stopped_at             │
│  last_pause_at                    ← pause/webhook guard │
│  pause_events: List<Map>  ← [{paused_at, resumed_at}]  │
│    Tracks each pause/resume cycle for post-processing   │
│    trimming. resumed_at is null if still paused.        │
│  s3_key                  ← from recording.ready-to-download │
│                                                         │
│  ── Session Metadata ──                                 │
│  host_user_id, host_name, guest_name                    │
│  daily_room_name, daily_room_url                        │
│  s3_processed_prefix, error_message                     │
│  created_at, updated_at, ttl                            │
└─────────────────────────────────────────────────────────┘
```

---

## Why Three Participant Fields?

We evaluated three approaches and chose the one that passes all 14 edge-case scenarios:

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  WHY NOT just a participant_count integer?                            │
│    FE calls join → count + 1                                         │
│    Webhook fires  → count + 1                                        │
│    RESULT: count = 3 (WRONG — double counted)                        │
│                                                                      │
│  WHY NOT just a user_id Set (without connection map)?                 │
│    Guest refreshes → old connection dies → webhook fires              │
│    → DELETE "guest-abc" from set → set drops to 1                    │
│    → Auto-pause triggered even though guest is still connected!      │
│    RESULT: Every refresh pauses the recording (BROKEN)               │
│                                                                      │
│  WHY NOT call Daily.co presence API instead of local tracking?       │
│    - Adds external dependency to every operation                     │
│    - Race condition on concurrent joins (both see count=1)           │
│    - 40+ API calls/minute/session for polling                        │
│    - If Daily API is slow/down, our app breaks                       │
│    RESULT: Fragile and expensive at scale                            │
│                                                                      │
│  CORRECT: user_id Set + connection Map                               │
│    active_participants: {"host-174...", "guest-abc..."}               │
│      → ADD/DELETE by user_id (idempotent)                            │
│      → size = true participant count                                 │
│    participant_connections: {"guest-abc...": "daily-conn-444"}        │
│      → on join: overwrite with latest connection_id                  │
│      → on webhook participant.left: check if connection_id matches   │
│        → stale (old connection from refresh) → SKIP removal          │
│        → current (real disconnect) → PROCEED with removal            │
│                                                                      │
│  This passes: refresh ✓, tab close ✓, crash ✓, network blip ✓,      │
│  concurrent join ✓, webhook re-delivery ✓, Daily API down ✓          │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Daily.co Webhook Reference (Actual Payloads)

We subscribe to **4 webhook events**. All events share these top-level fields:

```json
{
  "version": "1.0.0",
  "type": "participant.joined",          // event type
  "id": "ptcpt-join-6497c79b-...",       // IDEMPOTENCY KEY — use for dedup
  "payload": { ... },                    // event-specific data
  "event_ts": 1708972279.961             // when webhook was SENT (not event time)
}
```

### CRITICAL: Daily.co Field Name Mapping

```
┌──────────────────────────────────────────────────────────────────────┐
│  Daily.co Webhook Field   │  What It Actually Is   │  Our Name      │
├───────────────────────────┼────────────────────────┼────────────────┤
│  payload.user_id          │  The user_id we set    │  user_id       │
│                           │  in the meeting token  │  (our app ID)  │
│                           │  e.g. "host-174..."    │                │
├───────────────────────────┼────────────────────────┼────────────────┤
│  payload.session_id       │  Daily's per-connection│  connection_id │
│                           │  ID. Changes on every  │  (for stale    │
│                           │  reconnect/refresh.    │   detection)   │
│                           │  NOT our session_id!   │                │
├───────────────────────────┼────────────────────────┼────────────────┤
│  payload.room             │  Daily room name       │  room_name     │
│                           │  "session-{our_id}"    │  → extract     │
│                           │                        │    session_id  │
├───────────────────────────┼────────────────────────┼────────────────┤
│  payload.user_name        │  Name we set in token  │  user_name     │
├───────────────────────────┼────────────────────────┼────────────────┤
│  payload.owner            │  is_owner from token   │  is_host       │
└───────────────────────────┴────────────────────────┴────────────────┘
```

### 1. participant.joined

```json
{
  "version": "1.0.0",
  "type": "participant.joined",
  "id": "ptcpt-join-6497c79b-f326-4942-aef8-c36a29140ad1-1708972279961",
  "payload": {
    "room": "session-abc123def456",
    "user_id": "host-174...",              // ← OUR user_id from token
    "user_name": "Alice",                  // ← OUR user_name from token
    "session_id": "6497c79b-f326-...",     // ← Daily's CONNECTION ID (changes on refresh)
    "joined_at": 1708972279.96,
    "will_eject_at": 1708972299.541,
    "owner": true,
    "permissions": { "hasPresence": true, "canSend": ["audio"], ... }
  },
  "event_ts": 1708972279.961
}
```

**We use**: `room` → extract our session_id, `user_id` → our user_id, `session_id` → connection_id for stale detection, `user_name` → for roster

### 2. participant.left

```json
{
  "version": "1.0.0",
  "type": "participant.left",
  "id": "ptcpt-left-16168c97-...-1708972302986",
  "payload": {
    "room": "session-abc123def456",
    "user_id": "guest-abc...",             // ← OUR user_id from token
    "user_name": "Bob",
    "session_id": "16168c97-f973-...",     // ← Daily's CONNECTION ID
    "joined_at": 1708972291.567,
    "will_eject_at": null,
    "owner": false,
    "permissions": { ... },
    "duration": 11.419
  },
  "event_ts": 1708972302.986
}
```

**We use**: `room` → session_id, `user_id` → our user_id, `session_id` → connection_id (for stale check against participant_connections map)

### 3. recording.ready-to-download

```json
{
  "version": "1.0.0",
  "type": "recording.ready-to-download",
  "id": "rec-rtd-c3df927c-...-1692124192",
  "payload": {
    "type": "raw-tracks",                  // ← our recording type
    "recording_id": "08fa0b24-9220-...",
    "room_name": "session-abc123def456",   // ← NOTE: "room_name" not "room"
    "start_ts": 1692124183,
    "status": "finished",
    "max_participants": 2,
    "duration": 9,
    "s3_key": "domain/room/timestamp",     // ← WHERE files are in S3
    "tracks": [ ... ]                      // ← raw track info (for raw-tracks type)
  },
  "event_ts": 1692124192
}
```

**We use**: `room_name` → session_id, `s3_key` → store for processing pipeline, `recording_id` → verify match. Fires ONCE per session (one continuous recording — pause/resume do not stop/start Daily recording). Purely for S3 data capture + safety net reconciliation.

### 4. recording.error

```json
{
  "version": "1.0.0",
  "type": "recording.error",
  "id": "rec-err-c3df927c-...-1693402871",
  "payload": {
    "action": "cloud-recording-error",
    "error_msg": "cloud-recording-error: ...",  // ← NOTE: "error_msg" not "error"
    "instance_id": "c3df927c-...",
    "room_name": "session-abc123def456",        // ← NOTE: "room_name" not "room"
    "timestamp": "1693402871"
  },
  "event_ts": 1693402871.203
}
```

**We use**: `room_name` → session_id, `error_msg` → store as error_message. TERMINAL — always applies.

### Events We Do NOT Handle

```
recording.started      — No "room" field in payload, can't easily map to session.
                         Not needed: FE /start already writes everything to DynamoDB.
meeting.started        — Not needed (we create rooms ourselves)
meeting.ended          — Not needed (we track participants ourselves)
All others             — Not relevant to our audio recording use case
```

### HMAC Signature Verification

```
Daily sends:
  Header: X-Webhook-Signature (Base64-encoded HMAC)
  Header: X-Webhook-Timestamp (Unix timestamp string)

Verification (Python):
  import base64, hashlib, hmac

  secret_bytes = base64.b64decode(hmac_secret)           # Base64 DECODE the stored secret
  message = f"{timestamp}.{raw_body_string}".encode()    # timestamp + '.' + body
  computed = base64.b64encode(                            # Base64 ENCODE the result
      hmac.new(secret_bytes, message, hashlib.sha256).digest()
  ).decode()
  assert computed == signature_header                     # Compare

Current code uses hexdigest() with raw secret — MUST be fixed.
```

### Webhook Delivery Guarantees

```
- Events delivered roughly in order, but NOT strictly ordered
- DUPLICATES are possible — use top-level "id" field as idempotency key
- Must return 200 quickly — respond BEFORE processing
- Retry: circuit-breaker (default, fails after 3 consecutive failures)
         or exponential (per-message, 5 retries with backoff up to 15min)
- After 3 consecutive failures: webhook enters FAILED state, stops delivering
```

---

## State Machine

```
                                                      ┌──────────┐
                                                      │          │
  created ──→ waiting_for_guest ──→ ready ──→ recording ⇄ paused  │
    (0)              (1)             (2)        (3)        (3)    │
                                                                  │
                                     participant leaves/crashes    │
                                     during recording ──→ paused  │
                                     (auto-pause, recoverable)    │
                                                                  │
                                     both rejoin + resume ──→ recording
                                                                  │
           ONLY "End Session" button (host):                      │
             recording/paused ──→ processing ──→ completed        │
                                     (5)           (6)            │
                                      │                           │
                                      ▼                           │
                                    error ◄───────────────────────┘
                                     (6)        (from any state)

Numbers = STATUS_PRIORITY — webhooks can only move forward (or lateral), never backward.
```

### Transition Rules

| From | To | Triggered By | Condition |
|------|----|-------------|-----------|
| created | waiting_for_guest | FE join / webhook participant.joined | set size becomes 1 |
| waiting_for_guest | ready | FE join / webhook participant.joined | set size becomes >= 2 |
| ready | recording | FE POST /start (host only) | conditional: status = ready (requires 2 participants) |
| recording | paused | FE POST /pause (host only) | conditional: status = recording. DynamoDB only — Daily recording keeps running. Appends to pause_events. |
| recording | paused | FE POST /leave OR webhook participant.left | participant leaves during recording → auto-pause. DynamoDB only — Daily recording keeps running. |
| paused | recording | FE POST /resume (host only) | conditional: status = paused AND set size >= 2. DynamoDB only — updates last pause_events entry with resumed_at. |
| ready | waiting_for_guest | FE POST /leave OR webhook participant.left | participant leaves before recording (only allowed backward move) |
| recording/paused | processing | FE POST /end (host only, explicit) | conditional: status IN (recording, paused). Calls Daily stop_recording() (the ONLY stop). **ONLY terminal user action.** |
| processing | completed | Lambda (audio merge done) | Lambda writes directly |
| ANY | error | webhook recording.error / Lambda failure | terminal — always applies |

### Key Behavioral Rules

```
┌──────────────────────────────────────────────────────────────────┐
│  LOGICAL PAUSE — Daily recording runs continuously               │
│                                                                  │
│  Daily.co has NO native pause API. Only start/stop.              │
│  Calling stop then start creates a NEW S3 folder (different      │
│  epoch_time), introduces race conditions (async finalization),   │
│  and complicates post-processing.                                │
│                                                                  │
│  Our approach: ONE continuous Daily recording per session.        │
│    - start_recording() called ONCE when host clicks "Start"      │
│    - stop_recording() called ONCE when host clicks "End Session" │
│    - Pause/resume only update DynamoDB status + pause_events     │
│    - Recording keeps running during pause (audio still captured) │
│    - Post-processing trims paused sections using pause_events    │
│    - Result: one S3 folder, one file per participant, no races   │
│                                                                  │
│  Auto-mute on pause:                                             │
│    - FE mutes both participants when status = paused             │
│    - FE unmutes both when status returns to recording            │
│    - Mute toggle is disabled during pause                        │
│    - This minimizes unwanted audio in paused sections            │
│                                                                  │
│  pause_events list in DynamoDB:                                  │
│    [ { "paused_at": "ISO", "resumed_at": "ISO" },               │
│      { "paused_at": "ISO", "resumed_at": null }  ]              │
│    - Appended on pause, last entry updated on resume             │
│    - Post-processing reads these to trim silence/paused audio    │
│    - If session ends while paused, last resumed_at stays null    │
│      → post-processing trims from last paused_at to end          │
└──────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────┐
│  1. START requires 2 participants.                               │
│     Host cannot start recording until guest has joined.          │
│     Backend validates: status = ready (which means set size >=2) │
│     Backend calls Daily.co start_recording() — the ONLY start.  │
│                                                                  │
│  2. LEAVE during recording = auto-pause (logical).               │
│     - Backend updates DynamoDB: status=paused, appends to        │
│       pause_events with {paused_at: now, resumed_at: null}       │
│     - Daily recording keeps running (NOT stopped)                │
│     - FE auto-mutes both participants                            │
│     - The remaining participant sees "Recording paused —         │
│       [other person] disconnected. Waiting to rejoin..."         │
│     - The person who left can rejoin with their token            │
│     - Once both are back, host can click "Resume"                │
│                                                                  │
│  3. LEAVE when NOT recording = just remove from set.             │
│     - Status may regress: ready → waiting_for_guest              │
│       (the only allowed backward transition)                     │
│     - When they rejoin, status advances back to ready            │
│                                                                  │
│  4. BOTH leave = session stays paused.                           │
│     - Recording keeps running, room is alive (2hr TTL)           │
│     - Either participant can rejoin at any time                  │
│     - Daily room expiry (2hr) will eventually clean up           │
│     - DynamoDB TTL (30 days) cleans the record                   │
│                                                                  │
│  5. "End Session" is the ONLY terminal action.                   │
│     - Host-only, explicit button click with confirmation dialog  │
│     - Backend calls Daily.co stop_recording() — the ONLY stop   │
│     - Moves to processing → completed (irreversible)             │
│     - This is the only path to processing state from user action │
│                                                                  │
│  6. Tab close / browser crash = webhook handles it.              │
│     - Daily detects disconnect after ~10-30s heartbeat timeout   │
│     - Webhook fires participant.left → backend auto-pauses       │
│       (DynamoDB only — recording keeps running)                  │
│     - No sendBeacon — avoids refresh-triggers-leave bug          │
│                                                                  │
│  7. REFRESH = no disruption.                                     │
│     - Old connection dies, new one joins in ~3s                  │
│     - POST /join overwrites connection map with new conn ID      │
│     - Webhook for old connection sees stale conn ID → SKIP       │
│     - Recording continues uninterrupted                          │
└──────────────────────────────────────────────────────────────────┘
```

---

## What the SDK Owns vs What the Server Owns

| Concern | Owner | Why |
|---------|-------|-----|
| Session status (recording, paused, etc.) | **Server** | Survives refresh, single source of truth |
| Who is in the room (active_participants) | **Server** | Survives refresh, deduplication |
| Who has ever joined (participants roster) | **Server** | Show names even after disconnect |
| Recording state | **Server** (`status` + `recording_started_at`) | Survives refresh |
| Timer elapsed time | **Server** (derived from `recording_started_at`) | Consistent across participants |
| Mute/unmute | **SDK** (local only) | Per-device, no need to persist. Auto-muted during pause, toggle disabled. |
| Mic level meter | **SDK** (local only) | Real-time visualization |
| Network quality | **SDK** (local only) | Per-device diagnostic |
| Audio transport | **SDK** (WebRTC) | Real-time audio streaming |
| Participant audio status (muted badge) | **SDK** (`participant.audio`) | Real-time, no need to persist |

---

## DynamoDB Operations & Idempotency

### Join Operation (FE POST /join and webhook participant.joined)

```python
# FE POST /join sends: { user_id, connection_id, user_name }
#   user_id      = our app's user ID (e.g. "host-174...", from token)
#   connection_id = Daily's session_id from SDK (changes on every reconnect)
#   user_name    = display name
#
# Webhook participant.joined sends:
#   payload.user_id    = same as above (set by token)
#   payload.session_id = same as connection_id above (Daily's per-connection ID)
#   payload.user_name  = same as above (set by token)
#
# Both use the SAME atomic DynamoDB update:
# 1. ADD user_id to active_participants set (idempotent)
# 2. SET participant_connections[user_id] = connection_id (overwrite on reconnect)
# 3. SET participants[user_id] = user_name (roster, write-once)
table.update_item(
    Key={"session_id": session_id},
    UpdateExpression="""
        ADD active_participants :user_set
        SET participant_connections.#uid = :conn_id,
            participants.#uid = if_not_exists(participants.#uid, :name),
            updated_at = :now
    """,
    ExpressionAttributeNames={"#uid": user_id},
    ExpressionAttributeValues={
        ":user_set": {user_id},          # DynamoDB String Set
        ":conn_id": connection_id,        # Daily's session_id (connection-level ID)
        ":name": user_name,               # Display name (write-once)
        ":now": now_iso(),
    },
    ReturnValues="ALL_NEW",
)
# → Read active_participants set size from response to determine count
# → Transition status based on count
```

### Leave Operation (FE POST /leave — explicit button only)

```python
# Remove user from active set and connection map
table.update_item(
    Key={"session_id": session_id},
    UpdateExpression="""
        DELETE active_participants :user_set
        REMOVE participant_connections.#uid
        SET updated_at = :now
    """,
    ExpressionAttributeNames={"#uid": user_id},
    ExpressionAttributeValues={
        ":user_set": {user_id},
        ":now": now_iso(),
    },
    ReturnValues="ALL_NEW",
)
# → Read set size → logical auto-pause if recording and count < 2
#   (DynamoDB status only — Daily recording keeps running, append to pause_events)
# NOTE: participants roster is NOT removed — name stays for UI display
```

### Webhook participant.left — Stale Connection Check

```python
# Webhook payload fields:
#   payload.user_id    = our token user_id (e.g. "guest-abc...")
#   payload.session_id = Daily's connection ID (e.g. "16168c97-f973-...")
#                        (Daily confusingly calls this "session_id" but it's per-connection)
#   payload.room       = Daily room name (e.g. "session-abc123def456")

# CRITICAL: Check if this webhook is for the CURRENT connection
# or a STALE one (e.g. from a page refresh)
session = session_repo.get_by_id(our_session_id)  # extracted from payload.room
stored_conn = session.participant_connections.get(payload_user_id)

if stored_conn is None:
    # FE /leave already removed this user's connection entry → SKIP
    logger.info("Webhook skip: user %s already removed by FE /leave", payload_user_id)
    return

if stored_conn != payload_session_id:  # payload.session_id = Daily's connection ID
    # STALE — user already reconnected with a new connection
    # This webhook is for their old connection → ignore
    logger.info("Stale webhook: user %s reconnected (stored=%s, webhook=%s)",
                payload_user_id, stored_conn, payload_session_id)
    return

# CURRENT — user really disconnected → proceed with removal
session_repo.remove_participant(our_session_id, payload_user_id)
# → Read set size → logical auto-pause if recording and count < 2
#   (DynamoDB only — Daily recording keeps running, append to pause_events)
```

### Conditional Updates (Recording Actions)

```python
# Start recording — ONLY if status is ready (requires 2 participants)
# This is the ONLY place that calls Daily.co start_recording()
table.update_item(
    Key={"session_id": session_id},
    UpdateExpression="SET #s = :new_status, version = version + :one, pause_events = :empty_list, ...",
    ConditionExpression="#s = :required_status",
    ExpressionAttributeNames={"#s": "status"},
    ExpressionAttributeValues={
        ":new_status": "recording",
        ":required_status": "ready",
        ":one": 1,
        ":empty_list": [],
    },
)
# If condition fails → ConditionalCheckFailedException → return 400

# Pause — only if status is recording (DynamoDB only, NO Daily API call)
#   Appends {paused_at: now, resumed_at: null} to pause_events list
# Resume — only if status is paused AND active_participants size >= 2
#   (DynamoDB only, NO Daily API call)
#   Updates last pause_events entry: set resumed_at = now
# End Session — only if status is recording or paused
#   This is the ONLY place that calls Daily.co stop_recording()
# All use the same conditional pattern with different condition values
```

---

## Complete User Journey

### Flow 1: Host Creates Session

```
USER ACTION: Host fills form → clicks "Create Session"

FRONTEND                              BACKEND                           DYNAMODB
────────                              ───────                           ────────
POST /sessions/                  ──→  create_room() via Daily API
{ host_user_id,                       create_token(host)
  host_name, guest_name }             create_token(guest)
                                      PUT session item             ──→  status: created
                                                                        active_participants: {}
                                                                        participant_connections: {}
                                                                        participants: {}
                                                                        version: 0
                                 ←──  { session_id, room_url,
                                        host_token, guest_token,
                                        guest_join_url }

Store host_token in sessionStorage
  key: "audio-studio:{session_id}"
Dispatch SESSION_CREATED
Navigate to /session/{id}
```

### Flow 2: Host Joins Room

```
USER ACTION: AudioRoom mounts → auto-join

FRONTEND                              BACKEND                           DYNAMODB
────────                              ───────                           ────────
1. GET /sessions/{id}            ──→  Read session                 ──→  Return full session
                                 ←──  { status, host_name, ... }

2. Render UI from server state:
   status=created → "Connecting..."

3. useDaily.join(url, token)
   Daily SDK connects (WebRTC)
   SDK fires "joined-meeting"

4. Read from SDK after join:
   - local participant's session_id: "daily-conn-111"
     (Daily calls this session_id — it's the per-connection ID)
   - user_id from token: "host-174..." (our app user ID)
   - user_name from token: "Alice"

5. POST /sessions/{id}/join      ──→  Atomic DynamoDB update:     ──→  active_participants:
   { user_id: "host-174...",          ADD "host-174..." to set          {"host-174..."}
     connection_id: "daily-conn-111", SET connections["host-174..."]   participant_connections:
     user_name: "Alice" }               = "daily-conn-111"              {"host-174...":"daily-conn-111"}
                                      SET participants["host-174..."]  participants:
   BLOCKING — wait for response         = "Alice"                       {"host-174...":"Alice"}
                                      → set size = 1
                                      status=created, count=1
                                      → update to waiting_for_guest    status: waiting_for_guest
                                 ←──  { status: "waiting_for_guest" }

6. Dispatch STATUS_UPDATED
   → status: waiting_for_guest
   UI renders: "Waiting for guest..."
   Shows invite link
   "Start Recording" button DISABLED (need 2 participants)

WEBHOOK (participant.joined, ~1-3s later):
   payload: { user_id: "host-174...", session_id: "daily-conn-111", room: "session-xxx" }
   (user_id = our token user_id, session_id = Daily's connection ID)
   → Same atomic update: ADD "host-174..." to set → already exists → no-op
   → SET connections["host-174..."] = "daily-conn-111" → same value → no-op
   → set size still 1, status already waiting_for_guest → no transition
   → SKIP
```

### Flow 3: Guest Joins Session

```
USER ACTION: Guest clicks invite link → /join/{session_id}?t={token}

FRONTEND                              BACKEND                           DYNAMODB
────────                              ───────                           ────────
1. GET /sessions/{id}            ──→  Read session                 ──→  Return full session
                                 ←──  { status: waiting_for_guest,
                                        host_name, guest_name }

2. Render join page from server:
   "Join session with Alice?"

3. Guest clicks "Join Session"
   Store guest_token in sessionStorage
   Dispatch SESSION_JOINED
   Navigate to /session/{id}

4. AudioRoom mounts → GET /sessions/{id} → render from server state

5. useDaily.join(url, token)
   Read from SDK: session_id="daily-conn-222" (connection ID),
                  user_id="guest-abc...", user_name="Bob"

6. POST /sessions/{id}/join      ──→  Atomic DynamoDB update:     ──→  active_participants:
   { user_id: "guest-abc...",         ADD "guest-abc..." to set         {"host-174...","guest-abc..."}
     connection_id: "daily-conn-222", SET connections, participants     participant_connections:
     user_name: "Bob" }              → set size = 2                     {"host-174...":"daily-conn-111",
   BLOCKING                          status=waiting_for_guest,           "guest-abc...":"daily-conn-222"}
                                       count=2                          participants:
                                      → update to ready                  {"host-174...":"Alice",
                                 ←──  { status: "ready" }                "guest-abc...":"Bob"}
                                                                        status: ready
7. Dispatch STATUS_UPDATED
   Guest UI: "Both connected. Waiting for host to start recording"

HOST SIDE (how host learns):
   - Daily SDK fires "participant-joined" → triggers immediate poll
   - GET /sessions/{id} → status: ready, set size 2
   - "Start Recording" button ENABLES

WEBHOOK (participant.joined for guest):
   payload: { user_id: "guest-abc...", session_id: "daily-conn-222", room: "session-xxx" }
   → Same atomic update → ADD "guest-abc..." → already in set → no-op
   → status already ready → no transition → SKIP
```

### Flow 4: Host Starts Recording

```
USER ACTION: Host clicks "Start Recording"

FRONTEND                              BACKEND                           DYNAMODB
────────                              ───────                           ────────
1. Show loading on button

2. POST /sessions/{id}/start     ──→  Read session
   BLOCKING                           Validate: status = ready
                                      (MUST be ready = 2 participants)
                                      Call Daily.co:
                                        start_recording(room_name)
                                        → recordingId: "rec-xyz"
                                      Conditional update:          ──→  status: recording
                                        SET status=recording,           recording_id: "rec-xyz"
                                            recording_id,               recording_started_at: now
                                            recording_started_at=now,   pause_events: []
                                            pause_events=[],            version: 1
                                            version=version+1
                                        CONDITION: status = ready
                                 ←──  { status: "recording",
                                        recording_started_at: "..." }

3. Dispatch STATUS_UPDATED
   Start timer from recording_started_at (server timestamp)
   UI: recording indicator, pulse border, timer, pause/end buttons

GUEST SIDE:
   - Daily SDK fires "recording-started" → triggers immediate poll
   - GET /sessions/{id} → status: recording, recording_started_at
   - UI: "Recording in progress", timer syncs from server timestamp

WEBHOOK (recording.started):
   → We do NOT handle this event (no "room" field in payload,
     can't easily map to session). Not needed — FE already
     wrote everything to DynamoDB before this arrives.

DOUBLE-CLICK PROTECTION:
   First POST: conditional update succeeds (status was ready → recording)
   Second POST: FAILS (status is recording, not ready) → 400
```

### Flow 5: Host Pauses Recording (Explicit)

```
USER ACTION: Host clicks "Pause"

FRONTEND                              BACKEND                           DYNAMODB
────────                              ───────                           ────────
1. Show loading on button

2. POST /sessions/{id}/pause     ──→  Read session
   BLOCKING                           Validate: status = recording
                                      (NO Daily API call — recording
                                       keeps running)
                                      Conditional update:          ──→  status: paused
                                        SET status=paused,              last_pause_at: now
                                            last_pause_at=now,          pause_events: append
                                            version=version+1             {paused_at: now,
                                        LIST_APPEND pause_events           resumed_at: null}
                                          with {paused_at, null}        version: 2
                                        CONDITION: status = recording
                                 ←──  { status: "paused" }

3. Dispatch STATUS_UPDATED
   Stop timer (freeze display)
   Auto-mute both participants (FE)
   Disable mute toggle
   UI: "Paused", resume/end buttons

GUEST SIDE:
   - Next poll (interval or SDK event) → status: paused
   - FE auto-mutes, disables mute toggle
   - UI: "Recording paused by host"

NOTE: Daily recording is still running. Audio captured during pause
      is trimmed in post-processing using pause_events timestamps.
```

### Flow 6: Host Resumes Recording

```
USER ACTION: Host clicks "Resume"

FRONTEND                              BACKEND                           DYNAMODB
────────                              ───────                           ────────
1. Show loading on button

2. POST /sessions/{id}/resume    ──→  Read session
   BLOCKING                           Validate: status = paused
                                      Validate: active_participants
                                        size >= 2 (both must be back)
                                      (NO Daily API call — recording
                                       is already running)
                                      Conditional update:          ──→  status: recording
                                        SET status=recording,           version: 3
                                            version=version+1           pause_events[-1].resumed_at
                                        Update last pause_events          = now
                                          entry: resumed_at=now
                                        CONDITION: status = paused
                                 ←──  { status: "recording" }

3. Dispatch STATUS_UPDATED
   Auto-unmute both participants (FE)
   Re-enable mute toggle
   Resume timer, recording UI

RESUME BLOCKED IF ALONE:
   Backend checks set size < 2 → returns 400
   FE shows: "Waiting for other participant to rejoin"
```

### Flow 7: Host Ends Session (ONLY Terminal Action)

```
USER ACTION: Host clicks "End Session"
             → Confirmation: "End recording and process audio?" [End Session] [Cancel]
             → Host clicks "End Session"

FRONTEND                              BACKEND                           DYNAMODB
────────                              ───────                           ────────
1. Show loading on button

2. POST /sessions/{id}/end       ──→  Read session
   BLOCKING                           Validate: status IN
                                        (recording, paused)
                                      Call Daily.co: stop_recording()
                                        (ALWAYS — this is the ONLY
                                         place stop is called,
                                         regardless of current status)
                                      Conditional update:          ──→  status: processing
                                        SET status=processing,          recording_stopped_at: now
                                            recording_stopped_at=now,   version: N+1
                                            version=version+1
                                        CONDITION: status IN
                                          (recording, paused)
                                 ←──  { status: "processing" }

3. Navigate to /session/{id}/complete
   Shows "Processing..." spinner

GUEST SIDE:
   - Daily SDK fires "recording-stopped" → triggers poll
   - Poll: status=processing
   - Show overlay: "Host ended the session" (2.5s)
   - Navigate to /session/{id}/complete

WEBHOOK (recording.ready-to-download, fires later when files hit S3):
   → Re-read → status=processing → already advanced → SKIP
   → Store s3_key + tracks data (needed by audio processing pipeline)
```

### Flow 8: Participant Leaves Mid-Recording (Explicit Button — Auto-Pause)

```
USER ACTION: Guest clicks "Leave Session" during recording

FRONTEND                              BACKEND                           DYNAMODB
────────                              ───────                           ────────
1. POST /sessions/{id}/leave     ──→  remove_participant              ──→ active_participants:
   { user_id: "guest-abc..." }        DELETE "guest-abc..." from set       {"host-174..."}
   BLOCKING                           REMOVE from connections map
                                      → set size = 1
                                      Re-read: status=recording, count=1
                                      count < 2 during recording:
                                        → AUTO-PAUSE (logical)
                                      (NO Daily API call — recording
                                       keeps running)
                                      Update: status=paused,          ──→  status: paused
                                        last_pause_at=now,                 last_pause_at: now
                                        append pause_events                pause_events: append
                                          {paused_at: now,                   {paused_at, null}
                                           resumed_at: null}
                                 ←──  { status: "paused" }

2. call.leave() + call.destroy()
3. Navigate away (guest can return via invite link)

HOST SIDE:
   - Daily SDK fires "participant-left" → triggers immediate poll
   - Poll: status=paused, set size=1
   - UI:
     ┌──────────────────────────────────────────────────┐
     │  ⏸ Recording Paused                              │
     │                                                  │
     │  Bob has disconnected.                           │
     │  Recording has been paused automatically.        │
     │  Waiting for Bob to rejoin...                    │
     │                                                  │
     │  [Resume Recording] (DISABLED — need 2)          │
     │  [End Session]      (available)                  │
     └──────────────────────────────────────────────────┘
   (Bob's name comes from participants roster — still in DynamoDB)

WEBHOOK (participant.left, ~10-30s later):
   payload: { user_id: "guest-abc...", session_id: "daily-conn-222", room: "session-xxx" }
   → Check: connections["guest-abc..."] → no entry (removed by /leave)
   → No stored connection to match → SKIP (already handled)
```

### Flow 9: Participant Leaves When NOT Recording

```
USER ACTION: Guest clicks "Leave Session" when status=ready

FRONTEND                              BACKEND                           DYNAMODB
────────                              ───────                           ────────
1. POST /sessions/{id}/leave     ──→  remove_participant
   { user_id: "guest-abc..." }        → set = {"host-174..."}, size=1
   BLOCKING                           Re-read: status=ready, count=1
                                      NOT recording → no auto-pause
                                      count < 2 and status=ready:
                                        → regress to waiting_for_guest   status: waiting_for_guest
                                 ←──  { status: "waiting_for_guest" }

HOST SIDE:
   - Poll: status=waiting_for_guest, 1 participant
   - UI: "Waiting for guest..." (back to waiting state)
   - "Start Recording" button DISABLED
```

### Flow 10: Guest Rejoins After Leaving (Recovery)

```
USER ACTION: Guest reopens invite link after having left mid-recording

FRONTEND                              BACKEND                           DYNAMODB
────────                              ───────                           ────────
1. Navigate to /join/{id}?t={token}
   OR reopen tab (token in sessionStorage)

2. GET /sessions/{id}            ──→  Read session
                                 ←──  { status: "paused",
                                        participants: {"host-174...":"Alice",
                                                       "guest-abc...":"Bob"},
                                        active_participants: ["host-174..."],
                                        recording_started_at: "...",
                                        pause_events: [{paused_at: "...",
                                                        resumed_at: null}] }

3. Render from server state:
   status=paused → show paused UI with timer frozen
   participants roster shows both names
   active set shows only host → "Bob ○ disconnected" display

4. useDaily.join(url, token)
   Read from SDK: session_id="daily-conn-444" (new connection ID),
                  user_id="guest-abc..."

5. POST /sessions/{id}/join      ──→  Atomic update:
   { user_id: "guest-abc...",         ADD "guest-abc..." to set        active_participants:
     connection_id: "daily-conn-444", SET connections["guest-abc..."]    {"host-174...","guest-abc..."}
     user_name: "Bob" }                = "daily-conn-444"              participant_connections:
   BLOCKING                           → set size = 2                    {"host-174...":"daily-conn-111",
                                      status=paused, count=2             "guest-abc...":"daily-conn-444"}
                                      → stays paused (host must resume)
                                 ←──  { status: "paused" }

6. Guest UI: "Paused. Waiting for host to resume."

HOST SIDE:
   - Daily SDK fires "participant-joined" → triggers poll
   - Poll: status=paused, set size=2
   - "Resume" button ENABLES
   - UI: "Bob has reconnected! [Resume Recording] [End Session]"

7. Host clicks "Resume" → Flow 6
```

### Flow 11: Page Refresh During Recording

```
USER ACTION: Guest hits F5 during recording

FRONTEND                              BACKEND                           DYNAMODB
────────                              ───────                           ────────
0s: Page unloads
    → No sendBeacon, no POST /leave
    → Daily SDK connection "daily-conn-222" drops
    → Daily server starts heartbeat countdown

2s: Page finishes reloading
    AudioRoom mounts
    Token from sessionStorage ✓

    GET /sessions/{id}           ──→  Read session
                                 ←──  { status: "recording",       (unchanged!)
                                        recording_started_at: "...",
                                        active_participants:
                                          ["host-174...","guest-abc..."],
                                        participants:
                                          {"host-174...":"Alice",
                                           "guest-abc...":"Bob"} }

    Render UI from server state:
    → status=recording → show recording UI (correct!)
    → timer = now - recording_started_at (correct!)
    → participants: both shown as connected

3s: useDaily.join(url, token)
    → NEW connection: "daily-conn-444"

    POST /sessions/{id}/join     ──→  Atomic update:
    { user_id: "guest-abc...",        ADD "guest-abc..." to set
      connection_id:                  → already in set → no-op         active_participants:
        "daily-conn-444" }            SET connections["guest-abc..."]    (unchanged, still 2)
    BLOCKING                            = "daily-conn-444"             participant_connections:
                                        (OVERWRITES old conn-222)       {"guest-abc...":"daily-conn-444"}
                                      → set size still 2 → no          ← updated
                                        transition needed
                                 ←──  { status: "recording" }         status: recording (unchanged)

~15s: Daily fires webhook participant.left for OLD connection "daily-conn-222"
      payload: { user_id: "guest-abc...", session_id: "daily-conn-222", room: "session-xxx" }
      (payload.user_id = our token user_id, payload.session_id = Daily's OLD connection ID)

      Backend:
        stored = connections["guest-abc..."] → "daily-conn-444"
        webhook session_id = "daily-conn-222"
        "daily-conn-444" != "daily-conn-222" → STALE CONNECTION → SKIP

      Log: "Stale webhook ignored: guest-abc... reconnected"

RESULT: Recording never paused. DB never changed. Host noticed nothing.
        The connection map is the key — it lets us detect that the user
        already reconnected, so the webhook for the old connection is stale.
```

### Flow 12: Tab Close During Recording

```
EVENT: Guest closes tab (Cmd+W) during recording

0s:   Tab closes. No FE code runs after this point.
      Daily SDK connection "daily-conn-222" drops.
      No sendBeacon, no POST /leave.

0-10s: Host still recording. Guest's audio track goes silent.
       Host may notice guest stopped talking.

~15s: Daily server: heartbeat timeout for "daily-conn-222"
      → fires webhook participant.left

      BACKEND (webhook):
        payload: { user_id: "guest-abc...", session_id: "daily-conn-222", room: "session-xxx" }
        (payload.user_id = our token user_id, payload.session_id = Daily's connection ID)
        stored = connections["guest-abc..."] → "daily-conn-222"
        webhook session_id "daily-conn-222" == stored "daily-conn-222" → CURRENT → proceed

        remove_participant("guest-abc...")
        → DELETE from set → size=1
        → REMOVE from connections map
        Re-read: status=recording, count=1
        → AUTO-PAUSE (logical)
        (NO Daily API call — recording keeps running)
        Update: status=paused, last_pause_at=now
        Append to pause_events: {paused_at: now, resumed_at: null}

~15s: Host's Daily SDK fires "participant-left" → triggers poll
      Poll: status=paused, set size=1
      UI: "Bob disconnected. Recording paused. Waiting for rejoin..."

LATER: Guest reopens link → Flow 10 (rejoin)
```

### Flow 13: Browser Crash During Recording

```
Same as Flow 12 — no FE code runs on crash.
Webhook is the ONLY handler. Same ~10-30s delay.
Same auto-pause behavior. Same recovery via rejoin.
```

### Flow 14: Host Leaves During Recording (Auto-Pause)

```
Same as Flow 8/12 but roles reversed.

Guest UI after host disconnects:
  ┌──────────────────────────────────────────────────┐
  │  ⏸ Recording Paused                              │
  │                                                  │
  │  Alice (host) has disconnected.                  │
  │  Recording has been paused automatically.        │
  │  Waiting for host to rejoin...                   │
  │                                                  │
  │  (Only the host can resume or end the session)   │
  └──────────────────────────────────────────────────┘
```

### Flow 15: Both Leave (Abandoned Session)

```
1. First to leave during recording → auto-pause (logical), set drops to 1
   Daily recording keeps running.
2. Second to leave → set drops to 0, status stays paused
   Daily recording still running (muted audio being captured).
3. Daily room stays alive (2hr TTL)
4. Either can rejoin within 2 hours
5. If nobody returns: Daily room expires (stops recording), DynamoDB TTL cleans up after 30 days
```

### Flow 16: Network Blip (Brief Disconnect)

```
EVENT: Guest's WiFi drops for 5 seconds, then recovers

0s:    Network drops. Daily SDK detects, starts reconnecting.
5s:    Network recovers. Daily SDK auto-reconnects.
       → Daily SDK reconnects WITHOUT firing "joined-meeting" again
       → No new POST /join from FE
       → Daily server sees reconnection, cancels heartbeat timeout
       → No webhook fires

RESULT: Nothing happens. No DB changes. Recording continues.
        Daily SDK handles brief blips internally.

IF NETWORK STAYS DOWN (>30s):
       → Daily fires participant.left webhook
       → Same as Flow 12 (tab close) — auto-pause
       → When network recovers, user reloads page → Flow 11 (refresh)
```

### Flow 17: Audio Processing (Async)

```
TRIGGER: Daily.co uploads raw audio tracks to S3 (~30-60s after stop)
         ONE S3 folder per session (one continuous recording)
         Files: {timestamp}-{participant-uuid}-audio-{track-start}.webm

S3 EVENT → audio-merger Lambda

LAMBDA:
  1. List tracks for session (one folder, one file per participant)
  2. If < 2 tracks → return (wait for next S3 event)
  3. If >= 2:
     a. Download all tracks
     b. Read pause_events from DynamoDB for this session
     c. Trim paused sections from each track using pause_events
        - For each {paused_at, resumed_at} pair, remove that time range
        - If resumed_at is null (ended while paused), trim from paused_at to end
     d. Convert, merge, upload processed files
  4. DynamoDB: status → completed, s3_processed_prefix set
  5. On error: status → error, error_message set

HOST/GUEST (on SessionComplete page):
  Polling every 3s: GET /sessions/{id}
  - processing → spinner: "Converting and merging audio tracks"
  - completed → "Audio files ready" + S3 path
  - error → error message
```

---

## Polling Strategy

```
┌──────────────────────────────────────────────────────────┐
│  TWO TYPES OF POLLS — DO NOT CONFUSE                     │
│                                                          │
│  1. INTERVAL POLL (every 3s)                             │
│     - Runs continuously while on AudioRoom page          │
│     - Keeps counterparty in sync (guest learns about     │
│       host's actions, host learns about guest leaving)   │
│     - Does NOT set loading flag (silent background)      │
│     - Uses pollSession() — separate from getSession()    │
│                                                          │
│  2. EVENT-TRIGGERED POLL (immediate)                     │
│     - Triggered when Daily SDK fires an event:           │
│       participant-joined, participant-left,               │
│       recording-started, recording-stopped                │
│     - Bypasses the 3s interval — polls immediately       │
│     - Resolves ambiguity within ~200ms instead of 3s     │
│     - Does NOT set loading flag                          │
│                                                          │
│  WHY EVENT-TRIGGERED POLL MATTERS:                       │
│     Guest's Daily SDK fires "recording-started" when     │
│     host starts. Instead of waiting up to 3s for the     │
│     next interval poll, we poll immediately. Guest sees  │
│     "Recording" within ~200ms of host clicking Start.    │
│                                                          │
│  SDK events we listen to for triggering polls:           │
│     - participant-joined → poll (someone entered)        │
│     - participant-left   → poll (someone left)           │
│     - recording-started  → poll (recording began)        │
│     - recording-stopped  → poll (paused or ended)        │
└──────────────────────────────────────────────────────────┘
```

---

## Webhook Reconciliation Rules

```
┌───────────────────────────────────────────────────────────────────┐
│  WEBHOOK HANDLER RULES (4 events)                                │
│                                                                  │
│  Payload field reminder:                                         │
│    payload.user_id    = OUR user_id (from token)                 │
│    payload.session_id = Daily's connection ID (changes on refresh)│
│    payload.room       = Daily room name (participant events)      │
│    payload.room_name  = Daily room name (recording events)        │
│                                                                  │
│  1. participant.joined                                           │
│     Extract: user_id, session_id (=connection_id), user_name     │
│     Action: same atomic join update (ADD to set, SET conn map)   │
│     Then: check set size, transition status if needed            │
│     Safety: if FE already handled → ADD is no-op                 │
│                                                                  │
│  2. participant.left (MOST CRITICAL — handles crash/tab close)   │
│     Extract: user_id, session_id (=connection_id)                │
│     FIRST: check connection map for staleness                    │
│       stored = participant_connections[user_id]                   │
│       IF stored != webhook's session_id                          │
│         → STALE (user refreshed, already reconnected) → SKIP     │
│       IF stored is missing (FE /leave already removed it)        │
│         → ALREADY HANDLED → SKIP                                 │
│       ELSE → CURRENT (real disconnect) → proceed:                │
│     Action: remove_participant (DELETE from set, REMOVE conn)    │
│     Then: if count < 2 during recording → AUTO-PAUSE (logical,  │
│       DynamoDB only — recording keeps running, append pause_events)│
│     Then: if count < 2 during ready → regress to waiting         │
│                                                                  │
│  3. recording.ready-to-download                                  │
│     Extract: room_name, recording_id, s3_key, tracks             │
│     Primary value: store s3_key + tracks for processing pipeline │
│     This fires ONCE per session (one continuous recording).      │
│     Guard: SKIP if status >= processing (already terminal)       │
│     If status is still recording/paused when this fires, it      │
│       means end_session's DynamoDB write failed — store s3_key   │
│       but do NOT advance status (only "End Session" does that).  │
│     NOTE: NEVER moves to processing — only "End Session" does    │
│     NOTE: no "recording.stopped" event exists in Daily.co        │
│                                                                  │
│  4. recording.error                                              │
│     Extract: room_name, error_msg (NOT "error")                  │
│     Action: SET status=error, error_message=error_msg            │
│     Guard: NONE — always applies (terminal state)                │
│     This is PRIMARY, not reconciliation — only source for        │
│     server-side recording failures                               │
│                                                                  │
│  NOT HANDLED: recording.started (no room field in payload,       │
│     can't map to session; FE already writes everything)          │
│                                                                  │
│  ALL HANDLERS: return 200 OK immediately (before processing)     │
│  ALL HANDLERS: use top-level "id" field for idempotency dedup    │
│  ALL HANDLERS: log what they did or why they skipped             │
└───────────────────────────────────────────────────────────────────┘
```

---

## Frontend Component → State Mapping

```
┌───────────────────────────────────────────────────────────────────┐
│ Component              │ Renders From              │ Source        │
├────────────────────────┼───────────────────────────┼───────────────┤
│ RecordingControls      │ sessionState.status       │ SERVER        │
│   - Start button       │ participant count >= 2    │ SERVER        │
│     enabled?           │   AND status=ready        │               │
│   - Resume button      │ status=paused AND         │ SERVER        │
│     enabled?           │   participant count >= 2  │               │
│   - Pause button       │ status=recording          │ SERVER        │
│   - End Session button │ status IN (recording,     │ SERVER        │
│     (with confirmation)│   paused) AND isHost      │               │
├────────────────────────┼───────────────────────────┼───────────────┤
│ Timer                  │ recording_started_at      │ SERVER        │
│                        │ sessionState.status       │ (derived)     │
├────────────────────────┼───────────────────────────┼───────────────┤
│ ParticipantStatus      │ participants roster       │ SERVER        │
│   (names, always shown)│   (who has ever joined)   │ (roster)      │
│   (connected status)   │ active_participants       │ SERVER        │
│                        │   (who is connected now)  │ (set)         │
│   (mute badges)        │ daily.participants.audio  │ SDK (realtime)│
├────────────────────────┼───────────────────────────┼───────────────┤
│ DisconnectBanner       │ status=paused AND         │ SERVER        │
│ "[Name] disconnected,  │ participant count < 2     │               │
│  recording paused..."  │ name from roster          │               │
├────────────────────────┼───────────────────────────┼───────────────┤
│ MuteButton             │ daily.isMuted             │ SDK (local)   │
│   disabled during pause│ sessionState.status       │ SERVER        │
│   auto-mute on pause   │   =paused → force mute    │               │
├────────────────────────┼───────────────────────────┼───────────────┤
│ MicLevelMeter          │ daily.micLevel            │ SDK (local)   │
├────────────────────────┼───────────────────────────┼───────────────┤
│ ConnectionStatus       │ daily.networkQuality      │ SDK (local)   │
├────────────────────────┼───────────────────────────┼───────────────┤
│ Session Info card       │ sessionState.*            │ SERVER        │
├────────────────────────┼───────────────────────────┼───────────────┤
│ Invite link card       │ sessionState.isHost       │ SERVER        │
│                        │ guestJoinUrl              │ SERVER        │
└────────────────────────┴───────────────────────────┴───────────────┘
```

---

## Error Handling Strategy

```
┌────────────────────────────────────────────────────────────────┐
│ Scenario                      │ Handling                       │
├───────────────────────────────┼────────────────────────────────┤
│ POST /start fails (network)   │ Show error toast, keep current │
│                               │ status, button re-enables      │
├───────────────────────────────┼────────────────────────────────┤
│ POST /start fails (400 —      │ Re-poll server, update status  │
│   not in ready state)         │ from response, no error shown  │
├───────────────────────────────┼────────────────────────────────┤
│ POST /join fails              │ Retry once after 2s. If fails  │
│                               │ again, show error + "Rejoin"   │
│                               │ button. Webhook will reconcile │
├───────────────────────────────┼────────────────────────────────┤
│ POST /leave fails             │ Still navigate away. Webhook   │
│                               │ will handle disconnect.        │
├───────────────────────────────┼────────────────────────────────┤
│ POST /resume fails (400 —     │ Show "Waiting for other        │
│   < 2 participants)           │ participant" message. Disable  │
│                               │ resume button.                 │
├───────────────────────────────┼────────────────────────────────┤
│ Poll fails (network blip)     │ Silent — next poll in 3s.      │
│                               │ Show connection warning after  │
│                               │ 3 consecutive failures.        │
├───────────────────────────────┼────────────────────────────────┤
│ Daily SDK error               │ Show error banner. User can    │
│                               │ still see session state from   │
│                               │ server. Offer "Reconnect".     │
├───────────────────────────────┼────────────────────────────────┤
│ recording.error webhook       │ Server sets status=error.      │
│                               │ Next poll picks it up.         │
│                               │ Navigate to complete page      │
│                               │ with error message.            │
├───────────────────────────────┼────────────────────────────────┤
│ Lambda fails                  │ Server sets status=error.      │
│                               │ SessionComplete shows error.   │
└───────────────────────────────┴────────────────────────────────┘
```

---

## Session Persistence & Rejoin

```
┌──────────────────────────────────────────────────────────────────┐
│  TOKEN STORAGE STRATEGY                                          │
│                                                                  │
│  Host:                                                           │
│    - After creation, store host_token in sessionStorage           │
│      key: "audio-studio:{session_id}"                            │
│    - On refresh: read from sessionStorage → rejoin               │
│    - sessionStorage survives refresh, cleared on tab close       │
│    - On tab close: no sendBeacon. Webhook handles disconnect.    │
│    - Reopening: host navigates to /session/{id},                 │
│      token retrieved from sessionStorage (if same browser tab)   │
│      OR from original creation response (if bookmarked)          │
│                                                                  │
│  Guest:                                                          │
│    - Token is in URL: /join/{id}?t={token}                       │
│    - After joining, also store in sessionStorage                 │
│    - On refresh: read from sessionStorage → rejoin               │
│    - On tab close: reopen invite link to rejoin                  │
│                                                                  │
│  AudioRoom mount sequence:                                       │
│    1. Read session_id from URL params                            │
│    2. Read token from sessionStorage (or URL for guest)          │
│    3. If no token → redirect to home (session expired/invalid)   │
│    4. GET /sessions/{id} → render UI from server state           │
│    5. If status is terminal (processing/completed/error) →       │
│       redirect to complete page                                   │
│    6. If status is active → join Daily room, POST /join          │
└──────────────────────────────────────────────────────────────────┘
```

---

## Disconnect Handling Summary

| Scenario | sendBeacon? | What triggers leave | Delay | Recording interrupted? |
|----------|------------|-------------------|-------|----------------------|
| **Refresh (F5)** | No | **Nothing** — old conn dies, new joins. Connection map detects stale webhook → SKIP | **No pause** | **No** |
| **Explicit "Leave" button** | No | FE `POST /leave` (immediate) | **Instant** | Logical auto-pause (DynamoDB only, Daily recording keeps running) |
| **Tab close (Cmd+W)** | No | Daily webhook after heartbeat timeout | **10-30s** | Logical auto-pause (DynamoDB only, Daily recording keeps running) |
| **Browser close (Cmd+Q)** | No | Daily webhook after heartbeat timeout | **10-30s** | Logical auto-pause (DynamoDB only, Daily recording keeps running) |
| **Browser crash** | No | Daily webhook after heartbeat timeout | **10-30s** | Logical auto-pause (DynamoDB only, Daily recording keeps running) |
| **Device shutdown** | No | Daily webhook after heartbeat timeout | **10-30s** | Logical auto-pause (DynamoDB only, Daily recording keeps running) |
| **Network blip (<10s)** | No | **Nothing** — Daily SDK auto-reconnects | **No pause** | **No** |
| **Network down (>30s)** | No | Daily webhook after heartbeat timeout | **10-30s** | Logical auto-pause (DynamoDB only, Daily recording keeps running) |

---

## Renamed Endpoints

| Old Name | New Name | Behavior |
|----------|----------|----------|
| `POST /sessions/{id}/stop` | `POST /sessions/{id}/end` | Terminal. Moves to processing. Host-only. Confirmation required. |
| `POST /sessions/{id}/leave` | `POST /sessions/{id}/leave` | Recoverable. Auto-pauses if recording. Participant can rejoin. |

---

## Files Changed (Complete List)

### Backend (8 files)

| File | Changes |
|------|---------|
| `api/app/models/session.py` | Remove `participant_count`, remove `recording_segments`. Add `active_participants: set[str]`, `participant_connections: dict[str,str]`, `participants: dict[str,str]` (roster), `version: int`, `last_pause_at: Optional[str]`, `s3_key: Optional[str]`, `pause_events: list[dict]`. Update serialization. |
| `api/app/repos/session_repo.py` | Add `add_participant(session_id, user_id, connection_id, user_name)` — atomic ADD+SET. Add `remove_participant(session_id, user_id)` — atomic DELETE+REMOVE. Add `conditional_update_status()`. Add `append_pause_event()` and `update_last_pause_event()` for pause_events list ops. Remove `increment_participant_count()`. |
| `api/app/services/session_service.py` | Join/leave accept `user_id`, `connection_id`, `user_name`. Leave triggers logical auto-pause if recording (DynamoDB only, NO Daily stop_recording). Webhook `on_participant_left` checks connection map for staleness. Replace `on_recording_stopped` with `on_recording_ready_to_download` (stores `s3_key`). Start calls `daily_client.start_recording()` (ONLY start). End calls `daily_client.stop_recording()` (ONLY stop). Pause/resume do NOT call Daily API — only update DynamoDB status + pause_events. |
| `api/app/routes/sessions.py` | Rename `/stop` to `/end`. Join/leave accept request body with `user_id`, `connection_id`, `user_name`. Return `active_participants`, `participants` roster in responses. |
| `api/app/routes/webhooks.py` | Fix HMAC verification (Base64 decode secret, `timestamp.body` message, Base64 encode result). Extract `user_id` and `session_id` (Daily's connection ID) from participant payloads. Use `room_name` (not `room`) for recording events. Handle `recording.ready-to-download` instead of `recording.stopped`. Use `error_msg` field for recording errors. Use `X-Webhook-Timestamp` header. |
| `api/app/types/requests.py` | Add `JoinRequest(user_id, connection_id, user_name)`, `LeaveRequest(user_id)`. |
| `api/app/types/responses.py` | Add `participant_count` (derived from set size), `active_participants: list[str]`, `participants: dict[str,str]` (roster), `s3_key: Optional[str]`, `pause_events: list[dict]`. Remove `recording_segments`. |
| `api/app/types/webhooks.py` | Rewrite to match actual Daily.co payloads. Participant events: `room`, `user_id`, `session_id` (connection ID), `user_name`, `owner`, `joined_at`, `duration`, `permissions`. Recording events: `room_name`, `recording_id`, `s3_key`, `tracks`, `error_msg`. Top-level: `id` (idempotency key). |

### Frontend (10 files)

| File | Changes |
|------|---------|
| `web/src/hooks/useDaily.ts` | Expose local participant's `session_id` (Daily's connection ID) and `user_id` (from token) after join. SDK events trigger `onSdkEvent` callback for poll triggering. Remove `isRecording` from state (server owns this). Add `setMuted(muted: boolean)` for auto-mute on pause. |
| `web/src/hooks/useSessionApi.ts` | Add `pollSession()` (no loading flag). Update `joinSession` to accept and send `user_id`, `connection_id`, `user_name`. Update `leaveSession` to send `user_id`. Rename `stopSession` to `endSession`. `joinSession` is blocking. |
| `web/src/hooks/useRecordingTimer.ts` | Add `syncWithServer(startedAt: string)` to derive elapsed from server timestamp. |
| `web/src/pages/AudioRoom.tsx` | Server-driven rendering. SDK events trigger polls. No sendBeacon/beforeunload. Disconnect banner when participant leaves during recording. Token from sessionStorage. Initial GET before join. Redirect to complete if terminal status. Auto-mute on pause (status=paused → call setMuted(true), disable mute toggle). Auto-unmute on resume (status=recording → call setMuted(false), enable mute toggle). |
| `web/src/pages/CreateSession.tsx` | Store host_token in sessionStorage after creation. |
| `web/src/pages/JoinSession.tsx` | Store guest_token in sessionStorage after joining. |
| `web/src/components/session/RecordingControls.tsx` | Confirmation dialog for "End Session". Resume disabled when < 2 participants (from server). Start disabled when not ready (from server). Rename stop to end. |
| `web/src/components/session/DisconnectBanner.tsx` | NEW: Shows when status=paused and participant count < 2. Name from participants roster. |
| `web/src/context/SessionContext.tsx` | Add `participantCount`, `recordingStartedAt`, `activeParticipants`, `participantsRoster` to state. All updated from poll responses. |
| `web/src/api/client.ts` | `joinSession` sends `{ user_id, connection_id, user_name }`. `leaveSession` sends `{ user_id }`. Rename `stopSession` to `endSession`. |
| `web/src/types/session.ts` | Add `active_participants: string[]`, `participants: Record<string, string>`, `participant_count: number` (derived), `s3_key: string | null`, `pause_events: Array<{paused_at: string, resumed_at: string | null}>`. Remove `recording_segments`. |
