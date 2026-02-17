# Audio Studio — Implementation Details

Complete end-to-end documentation of the Audio Studio platform: a two-participant
real-time audio recording application for dataset collection.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [User Journey — Stage by Stage](#2-user-journey--stage-by-stage)
   - [Stage 1: Home Page](#stage-1-home-page-)
   - [Stage 2: Green Room](#stage-2-green-room-roomroomidgreen-room)
   - [Stage 3: Studio (Recording Session)](#stage-3-studio-recording-session-roomroomid)
   - [Stage 4: Results Page](#stage-4-results-page-roomroomidresults)
3. [REST API Reference](#3-rest-api-reference)
4. [Socket.IO Event Reference](#4-socketio-event-reference)
5. [DynamoDB Schema & Operations](#5-dynamodb-schema--operations)
6. [S3 Storage & Upload Pipelines](#6-s3-storage--upload-pipelines)
7. [SQS Processing Pipeline](#7-sqs-processing-pipeline)
8. [WebRTC Signaling Flow](#8-webrtc-signaling-flow)
9. [Audio Recording Pipeline](#9-audio-recording-pipeline)
10. [Audio Metrics & Quality Monitoring](#10-audio-metrics--quality-monitoring)
11. [Race Condition Handling](#11-race-condition-handling)
12. [Error Handling Strategy](#12-error-handling-strategy)
13. [Reconnection & Crash Recovery](#13-reconnection--crash-recovery)
14. [Configuration & Environment Variables](#14-configuration--environment-variables)
15. [Constants & Thresholds](#15-constants--thresholds)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         BROWSER (React + Vite)                          │
│                                                                         │
│  ┌───────────┐  ┌──────────┐  ┌────────────┐  ┌─────────────────────┐   │
│  │ Socket.IO │  │  WebRTC  │  │ AudioWorklet│  │  S3 Direct Upload  │   │
│  │  Client   │  │   Peer   │  │  Recorder   │  │  (presigned URLs)  │   │
│  └─────┬─────┘  └────┬─────┘  └──────┬─────┘  └──────────-┬─────────┘   │
│        │             │               │                    │             │
└────────┼─────────────┼───────────────┼────────────────────┼─────────────┘
         │             │               │                    │
    WebSocket      P2P Audio       Local only          HTTP PUT
         │              │               │                    │
┌────────┼──────────────┼───────────────┼────────────────────┼─────────────┐
│        ▼              │               │                    ▼             │
│  ┌───────────┐        │               │           ┌──────────────┐       │
│  │  Express  │        │               │           │      S3      │       │
│  │ + Socket  │  (direct, no server)   │           │    Bucket    │       │
│  │   :4000   │        │               │           └──────────────┘       │
│  └─────┬─────┘        │               │                                  │
│        │              │               │                                  │
│  ┌─────┼──────────────┼───────────────┼──────────────────────────────-┐  │
│  │     ▼              │               │                               │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐      │  │
│  │  │ DynamoDB │  │  Redis   │  │   SQS    │  │   Secrets Mgr  │      │  │
│  │  │ 5 tables │  │ pub/sub  │  │ 2 queues │  │  (prod/stage)  │      │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └────────────────┘      │  │
│  │                      AWS / LocalStack                              │  │
│  └──────────────────────────────────────────────────────────────────-─┘  │
│                           SERVER                                         │
└────────────────────────────────────────────────────────────────────────-─┘
```

### Server Stack
- **Runtime**: Node.js 22, TypeScript 5.7
- **HTTP**: Express v5 with helmet, CORS, rate limiting
- **Realtime**: Socket.IO v4.8 with optional Redis adapter
- **Database**: DynamoDB (5 tables)
- **Storage**: S3 (presigned URLs — browser uploads directly, server never touches audio)
- **Queue**: SQS (FIFO processing queue + standard results queue)
- **Auth**: JWT (via `jsonwebtoken`)

### Frontend Stack
- **Framework**: React 19 with React Router v7
- **Bundler**: Vite 6
- **Styling**: Tailwind CSS 3.4
- **Realtime**: Socket.IO client
- **Audio**: Web Audio API (AudioWorklet / ScriptProcessor fallback)
- **Peer Audio**: WebRTC (RTCPeerConnection)
- **Persistence**: IndexedDB (crash recovery + upload resume)

### Server Directory Layout
```
server/src/
├── server.ts                   # Entry point, bootstrap orchestrator
├── env.ts                      # dotenv preload (runs before all imports)
├── config/
│   ├── index.ts                # 2-phase config: .env → Secrets Manager overlay
│   ├── secrets.ts              # AWS Secrets Manager fetch
│   └── constants.ts            # Re-export shared constants
├── infra/
│   ├── dynamodb.ts             # DynamoDB Document Client + table names
│   ├── s3.ts                   # S3 client, presigned URLs, multipart ops
│   ├── sqs.ts                  # SQS client, publish/receive/delete
│   └── redis.ts                # Redis pub/sub clients for Socket.IO adapter
├── middleware/
│   ├── auth.ts                 # JWT verification
│   ├── requestId.ts            # X-Request-Id correlation header
│   ├── errorHandler.ts         # Global error handler
│   └── rateLimit.ts            # express-rate-limit (3 limiters)
├── routes/
│   ├── meetings.ts             # Meeting CRUD
│   ├── upload.ts               # Simple single-PUT upload
│   ├── multipartUpload.ts      # Multipart upload lifecycle
│   ├── recordings.ts           # Recording metadata + download URLs
│   └── stats.ts                # Dashboard statistics
├── services/
│   ├── meetingService.ts       # Meeting business logic + race-safe ops
│   ├── uploadService.ts        # Presigned URL generation, key building
│   ├── pipelineService.ts      # SQS publish when both recordings ready
│   ├── metricsService.ts       # In-memory metrics aggregation + warnings
│   ├── greenRoomService.ts     # Mic check evaluation against thresholds
│   └── notificationService.ts  # Socket.IO push (processing results → clients)
├── repositories/
│   ├── meetingRepo.ts          # DynamoDB: Meetings table
│   ├── sessionRepo.ts          # DynamoDB: Sessions table + GSIs
│   ├── recordingRepo.ts        # DynamoDB: Recordings table + GSI
│   ├── recordingStateRepo.ts   # DynamoDB: RecordingState table
│   └── statsRepo.ts            # DynamoDB: GlobalStats atomic counters
├── socket/
│   ├── index.ts                # Handler registry + chat relay
│   ├── session.ts              # join-room, disconnect, reconnection
│   ├── signaling.ts            # WebRTC offer/answer/ICE relay
│   ├── recording.ts            # start/stop recording control
│   ├── greenRoom.ts            # mic-check evaluation
│   └── liveMetrics.ts          # audio-metrics ingestion + warnings
├── consumers/
│   └── processingResultConsumer.ts  # SQS long-poll → Socket.IO push
├── shared/
│   ├── types/
│   │   ├── meeting.ts          # Meeting, Session, Recording, RecordingState
│   │   ├── socket.ts           # Socket.IO event payloads
│   │   ├── processing.ts       # ProcessSessionMessage, ProcessingResult
│   │   ├── upload.ts           # Upload types
│   │   └── metrics.ts          # Audio metrics types
│   ├── constants/
│   │   ├── events.ts           # SOCKET_EVENTS enum
│   │   ├── limits.ts           # Business limits
│   │   └── thresholds.ts       # Audio quality thresholds
│   └── index.ts                # Barrel export
└── utils/
    ├── logger.ts               # Pretty (dev) / JSON (prod) logging
    ├── errors.ts               # AppError, ValidationError, NotFoundError, etc.
    └── validators.ts           # Input validation helpers
```

### Frontend Directory Layout
```
web/src/
├── main.tsx                    # React entry point
├── App.tsx                     # React Router setup
├── index.css                   # Tailwind base styles
├── pages/
│   ├── Home.tsx                # Create / join meeting
│   ├── GreenRoom.tsx           # Mic check + device selection
│   ├── Studio.tsx              # Live recording session (core page)
│   └── Results.tsx             # Post-session results + downloads
├── hooks/
│   ├── useSocket.ts            # Socket.IO connection + event routing
│   ├── useMeeting.ts           # REST API for meeting CRUD
│   ├── useRecorder.ts          # AudioWorklet recording lifecycle
│   ├── useWebRTC.ts            # Peer connection management
│   ├── useAudioMetrics.ts      # Real-time audio analysis (~60fps)
│   └── useUpload.ts            # S3 upload orchestration
├── services/
│   ├── socketService.ts        # Socket.IO singleton factory
│   ├── uploadService.ts        # Simple + multipart S3 upload logic
│   ├── storageService.ts       # IndexedDB CRUD (crash recovery + resume)
│   ├── recorderService.ts      # Web Audio API + AudioWorklet recording
│   ├── webrtcService.ts        # RTCPeerConnection factory + ICE queue
│   └── metricsService.ts       # Audio metrics computation
├── components/
│   ├── ChatPanel.tsx           # Real-time chat sidebar
│   ├── DeviceSelector.tsx      # Mic device picker dropdown
│   ├── ErrorBoundary.tsx       # React crash fallback UI
│   ├── QualityBadge.tsx        # Quality profile pill (P0–P4)
│   ├── UploadProgress.tsx      # Upload progress bar
│   ├── VolumeIndicator.tsx     # RMS/peak level meter
│   └── WarningBanner.tsx       # Quality warning stack
└── shared/                     # Mirrors server shared/ (types, constants, events)
```

---

## 2. User Journey — Stage by Stage

### Stage 1: Home Page (`/`)

**Component**: `Home.tsx` + `useMeeting` hook

The landing page. User can create a new session or join an existing one.

#### Create Session Flow

```
User types title → clicks "Create Session"
         │
         ▼
  useMeeting.createMeeting(title)
         │
         ▼
  POST /api/meetings ──────────────────────────────────────► Server
    Body: { title }                                            │
                                                               ▼
                                                     meetingService.createMeeting()
                                                               │
                                                     meetingRepo.createMeeting()
                                                               │
                                                     DynamoDB PutItem
                                                     Table: Meetings
                                                     PK: meetingId (UUID v4)
                                                     status: 'scheduled'
                                                               │
                                                               ▼
  Response: { meetingId, title, status, createdAt } ◄──────────┘
         │
         ▼
  navigate(`/room/${meetingId}/green-room`)
```

#### Join Session Flow

```
User types meetingId → clicks "Join Session"
         │
         ▼
  navigate(`/room/${meetingId}/green-room`)
  (No API call — meeting existence checked in Green Room / Studio)
```

#### Server: Meeting Creation

- **Route**: `POST /api/meetings` — requires JWT auth
- **Service**: `meetingService.createMeeting(body)`
  - Validates title (non-empty, ≤ 255 chars)
  - Generates UUID v4 for meetingId
  - Sets `status: 'scheduled'`, `createdAt: new Date().toISOString()`
  - All participant fields (`hostName`, `hostEmail`, `guestName`, `guestEmail`) initialized to `null`
- **Repository**: `meetingRepo.createMeeting(meeting)` — DynamoDB PutItem

---

### Stage 2: Green Room (`/room/:roomId/green-room`)

**Components**: `GreenRoom.tsx`, `DeviceSelector`, `VolumeIndicator`
**Hooks**: `useSocket`, `useAudioMetrics`

Pre-recording mic check. User selects their microphone, verifies audio levels
are acceptable, then proceeds to the studio.

#### Flow

```
┌─────────────────────────────────────────────────────────────┐
│                     GREEN ROOM PAGE                          │
│                                                              │
│  1. Enumerate audio input devices                            │
│     navigator.mediaDevices.enumerateDevices()                │
│     → populate DeviceSelector dropdown                       │
│                                                              │
│  2. Acquire mic stream (raw, no processing)                  │
│     getUserMedia({                                           │
│       audio: {                                               │
│         deviceId: { exact: selectedDeviceId },               │
│         echoCancellation: false,                             │
│         noiseSuppression: false,                             │
│         autoGainControl: false,                              │
│         sampleRate: 48000                                    │
│       }                                                      │
│     })                                                       │
│                                                              │
│  3. Start real-time metrics (useAudioMetrics)                │
│     AudioContext (48kHz) → MediaStreamSource → AnalyserNode  │
│     requestAnimationFrame loop (~60fps):                     │
│       → getByteTimeDomainData()                              │
│       → metricsService.computeMetrics()                      │
│       → { rms, peak, clipCount, silenceDuration, speech }    │
│       → VolumeIndicator renders levels                       │
│                                                              │
│  4. Socket.IO mic-check loop (every 1 second)                │
│     Client ──► mic-check { rms, peak, noiseFloor, clipping } │
│     Server ──► mic-status { level, noiseFloor, suggestions } │
│                                                              │
│  5. Readiness gate                                           │
│     "I'm Ready" button enabled when:                         │
│       level === 'good' AND noiseFloor !== 'unacceptable'     │
│                                                              │
│  6. Click "I'm Ready"                                        │
│     → stop metrics, release stream, disconnect socket        │
│     → navigate to /room/:roomId (Studio)                     │
└─────────────────────────────────────────────────────────────┘
```

#### Server: Mic Check Evaluation

**Socket handler**: `socket/greenRoom.ts`
**Service**: `greenRoomService.evaluate(metrics)`

```
Input: { rms, peak, noiseFloor, isClipping }

Evaluation logic:
  level:
    rms < MIC_TOO_QUIET (-40 dBFS)  → 'too-quiet'
    rms > MIC_TOO_LOUD (-6 dBFS)    → 'too-loud'
    else                             → 'good'

  noiseFloor:
    noiseFloor > NOISE_FLOOR_REJECT (-30 dBFS)  → 'unacceptable'
    noiseFloor > NOISE_FLOOR_NOISY (-35 dBFS)   → 'noisy'
    else                                         → 'clean'

  suggestions: (array of strings)
    'too-quiet'      → "Move closer to microphone" / "Increase input gain"
    'too-loud'       → "Move away from microphone" / "Reduce input gain"
    'unacceptable'   → "Environment too noisy" / "Use a quieter room"
    isClipping       → "Reduce volume — audio is clipping"

Output: mic-status event sent back to client AND broadcast to room
```

---

### Stage 3: Studio (Recording Session) (`/room/:roomId`)

**Component**: `Studio.tsx` — the core of the application
**Hooks**: `useSocket`, `useWebRTC`, `useRecorder`, `useAudioMetrics`, `useUpload`
**Components**: `VolumeIndicator`, `QualityBadge`, `WarningBanner`, `UploadProgress`, `ChatPanel`

Five subsystems run simultaneously in the Studio:

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        STUDIO — 5 SUBSYSTEMS                             │
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌───────────────────────┐  │
│  │  A. Socket.IO    │  │  B. WebRTC       │  │  C. Audio Recording   │  │
│  │  Room management │  │  Peer-to-peer    │  │  AudioWorklet capture │  │
│  │  Event routing   │  │  Live audio mon. │  │  WAV encoding         │  │
│  └──────────────────┘  └──────────────────┘  └───────────────────────┘  │
│                                                                          │
│  ┌──────────────────┐  ┌──────────────────┐                             │
│  │  D. Metrics      │  │  E. Upload       │                             │
│  │  Quality monitor │  │  S3 presigned    │                             │
│  │  Warning system  │  │  Simple/multipart│                             │
│  └──────────────────┘  └──────────────────┘                             │
└─────────────────────────────────────────────────────────────────────────┘
```

#### A. Room Initialization & Socket.IO

```
On mount:
  1. Acquire mic stream (same params as Green Room)
  2. Connect Socket.IO singleton
  3. Register all event listeners
  4. Start audio metrics
  5. Emit join-room once socket connected AND stream ready

Client → Server:  join-room { roomId, role, userId, userEmail }
Server → Client:  room-state { meeting, participants, recordingState }
Server → Room:    user-joined { userId, role, isReconnection }
```

##### Server: Join Room — Full Logic (socket/session.ts)

This is the most complex server-side handler:

```
1. VALIDATE
   roomId and role must be present

2. LAZY MEETING CREATION
   meetingService.getOrCreateMeeting(roomId)
   → DynamoDB conditional PutItem (attribute_not_exists(meetingId))
   → If exists: catches ConditionalCheckFailedException, fetches existing

3. RECONNECTION DETECTION
   sessionRepo.findActiveByUserId(userId)
   → Queries UserIndex GSI for active sessions
   → If found session for SAME meetingId:
       a. Old socket is a "ghost" — force disconnect it
       b. Send DUPLICATE_SESSION to old socket
       c. Wait 800ms (GHOST_SOCKET_DELAY_MS) for adapter cleanup
       d. Update session's socketId via sessionRepo.updateSocketId()
       e. Preserve original role and email
       f. Set isReconnection = true

4. NEW USER — CAPACITY CHECK
   sessionRepo.getActiveSessionCount(roomId)
   → If ≥ MAX_PARTICIPANTS (2):
       emit ROOM_FULL → disconnect socket → return

5. NEW USER — CREATE SESSION
   sessionId = `${userId}#${joinedAt}`
   sessionRepo.createSession({
     meetingId, sessionId, userId, userRole, userEmail,
     socketId: socket.id, joinedAt, leftAt: null, isActive: true
   })
   statsRepo.incrementActiveSession()

6. ATTACH METADATA TO SOCKET
   socket.roomId = roomId
   socket.userId = userId
   socket.userRole = role
   socket.userEmail = email
   socket.join(roomId)  // Join Socket.IO room

7. FETCH RECORDING STATE
   recordingStateRepo.getOrCreateDefault(roomId)
   → If not exists: creates default { isRecording: false }

8. NOTIFY ROOM
   Broadcast USER_JOINED to room (excluding sender)
   If reconnection: broadcast PEER_RECONNECTED { userId, newSocketId }

9. SEND ROOM STATE TO JOINER
   Fetch all active sessions for this meeting
   Build participants array: [{ socketId, userId, role, userEmail }, ...]
   Emit ROOM_STATE { meeting, participants, recordingState }

10. RESUME RECORDING (if applicable)
    If recordingState.isRecording AND isReconnection AND startedAt exists:
      Calculate elapsedSeconds = (now - startedAt) / 1000
      Emit RESUME_RECORDING { startedAt, elapsedSeconds, sessionId }
```

##### Server: Disconnect Handler

```
On socket disconnect:
  1. sessionRepo.markSessionInactiveBySocketId(socket.id)
     → Queries SocketIndex GSI → UpdateItem: isActive=false, leftAt=now

  2. Broadcast USER_LEFT { userId, role } to room

  3. statsRepo.decrementActiveSession()
```

#### B. WebRTC Peer Connection

Both participants hear each other in real-time via direct peer-to-peer audio.
The server only relays signaling messages — audio never touches the server.

```
Peer A (first joiner)                Server                  Peer B (second joiner)
─────────────────────                ──────                  ──────────────────────
                                                              joins room
                                     ◄── join-room ──────────
user-joined event ◄──── broadcast ──

initConnection(peerId=B)
  RTCPeerConnection created
  localStream added
  createOffer()
  setLocalDescription(offer)
offer { target:B, sdp } ───────────► relay ─────────────────► handleIncomingOffer()
                                                                RTCPeerConnection created
                                                                localStream added
                                                                setRemoteDescription(offer)
                                                                createAnswer()
                                                                setLocalDescription(answer)
                                     ◄── relay ◄──────────── answer { target:A, sdp }
setRemoteDescription(answer) ◄──────
flush queued ICE candidates

ice-candidate ──────────────────────► relay ─────────────────► addIceCandidate
                                     ◄── relay ◄──────────── ice-candidate
addIceCandidate ◄───────────────────

  ═══════════════ P2P audio flowing directly ═══════════════
  (no server involvement — STUN/TURN for NAT traversal only)
```

**ICE Servers**:
- STUN: `stun:stun.l.google.com:19302`, `stun:stun1.l.google.com:19302`
- TURN: Optional, from env vars `VITE_TURN_URL`, `VITE_TURN_USERNAME`, `VITE_TURN_CREDENTIAL`

**ICE Candidate Queuing**: Candidates may arrive before `setRemoteDescription()`.
The client queues them in `Map<RTCPeerConnection, candidate[]>` and flushes
after the remote description is set.

**Remote Audio Playback**: The received `remoteStream` is attached to a hidden
`<audio autoplay>` element.

#### C. Audio Recording

Local lossless recording using Web Audio API. Each participant records their
own microphone independently — the recorded audio never flows through the server
or WebRTC connection.

```
Recording Pipeline:

MediaStream (48kHz mono)
    │
    ▼
AudioContext (sampleRate: 48000)
    │
    ▼
MediaStreamSourceNode
    │
    ▼
AudioWorkletNode (preferred) ─── or ─── ScriptProcessorNode (fallback)
    │                                            │
    ▼                                            ▼
process() callback: Float32Array chunk      onaudioprocess: Float32Array chunk
    │                                            │
    ├──► In-memory array (chunks[])              ├──► In-memory array
    │                                            │
    └──► IndexedDB (fire-and-forget)             └──► IndexedDB (fire-and-forget)
         storageService.saveChunk()                   storageService.saveChunk()
         sessionKey: roomId:userId:sessionId          sessionKey: roomId:userId:sessionId
         chunkIndex: sequential counter               chunkIndex: sequential counter
```

##### Start Recording

```
Host clicks "Start Recording"
         │
         ▼
emit START_RECORDING { roomId }
         │
         ▼  (server)
recordingStateRepo.startRecording(roomId, sessionId=UUID, socketId, userId)
meetingService.updateStatus(roomId, 'recording')
statsRepo.incrementActiveRecording()
         │
         ▼
broadcast START_RECORDING { sessionId } to room
         │
         ▼  (both clients)
recorderService.start(localStream, sessionKey)
  → Create AudioContext (48kHz)
  → MediaStreamSource → AudioWorkletNode
  → chunks = [], chunkIndex = 0
  → Each chunk (~23ms = 1024 samples at 48kHz):
      chunks.push(float32Array)
      storageService.saveChunk(sessionKey, chunkIndex++, data)  // IndexedDB, fire-and-forget
```

##### Stop Recording

```
Host clicks "Stop Recording"
         │
         ▼
emit STOP_RECORDING { roomId }
         │
         ▼  (server)
recordingStateRepo.stopRecording(roomId)
meetingService.updateStatus(roomId, 'active')
statsRepo.decrementActiveRecording()
         │
         ▼
broadcast STOP_RECORDING to room
         │
         ▼  (both clients)
recorderService.stop()
  → Disconnect AudioWorklet/ScriptProcessor
  → Encode all chunks into WAV blob
  → Clear IndexedDB chunks for this session
  → Return WAV blob
         │
         ▼
useUpload.upload(blob, roomId, userId, sessionId)
```

##### WAV Encoding

```
WAV File Structure (44 bytes header + PCM data):

Offset  Size  Field                Value
──────  ────  ─────                ─────
0       4     ChunkID              "RIFF"
4       4     ChunkSize            fileSize - 8
8       4     Format               "WAVE"
12      4     Subchunk1ID          "fmt "
16      4     Subchunk1Size        16 (PCM)
20      2     AudioFormat          1 (PCM, uncompressed)
22      2     NumChannels          1 (mono)
24      4     SampleRate           48000
28      4     ByteRate             96000 (48000 x 1 x 16/8)
32      2     BlockAlign           2 (1 x 16/8)
34      2     BitsPerSample        16
36      4     Subchunk2ID          "data"
40      4     Subchunk2Size        numSamples x 2
44+     ...   PCM sample data      Int16, little-endian

Float32 → Int16 conversion:
  sample = Math.max(-1, Math.min(1, float32Sample))
  int16 = sample < 0 ? sample * 0x8000 : sample * 0x7FFF
```

#### D. Audio Metrics & Quality Monitoring

Real-time quality monitoring during recording. The client computes metrics
locally at ~60fps and sends batches to the server every 5 seconds.

```
Client (every frame, ~60fps):
  AnalyserNode.getByteTimeDomainData()
  → metricsService.computeMetrics():
      RMS (dBFS)     = 20 * log10(sqrt(sum(s²) / N))
      Peak (dBFS)    = 20 * log10(max(|sample|))
      ClipCount      = samples where |value| ≥ 0.99
      SilenceDuration = cumulative time below SILENCE_THRESHOLD (-50 dBFS)
      SpeechDetected  = RMS > -50 dBFS
  → VolumeIndicator renders in real-time

Client (every 5 seconds):
  emit AUDIO_METRICS {
    sessionId, timestamp, rms, peak, clipCount,
    silenceDuration, speechDetected
  }

Server (socket/liveMetrics.ts):
  metricsService.ingestMetrics(roomId, sessionId, speaker, batch)
  → Updates in-memory running averages (Map<string, RoomMetricsAggregate>)
  → Detects threshold violations:
      clipCount ≥ CLIP_WARNING_COUNT (5) → 'clipping' warning
      rms < MIC_TOO_QUIET (-40)          → 'too-quiet' warning
      rms > MIC_TOO_LOUD (-6)            → 'too-loud' warning
      silence ≥ SILENCE_WARNING_MS (30s) → 'long-silence' warning
  → Returns warnings array

  For each warning:
    broadcast RECORDING_WARNING { type, speaker, message, severity }

  Compute quality snapshot:
    metricsService.getQualityUpdate(roomId, sessionId)
    → Estimates quality profile (P0–P4) from running averages
    broadcast QUALITY_UPDATE { estimatedProfile, metrics }
```

**Quality warning severity**:
- `warning`: Informational — recording still usable
- `critical`: Serious issue — may result in rejection

**Quality profile estimates (live)**:
- P0 (Pristine): SNR ≥ 25dB, no clips, minimal overlap
- P1 (Good): SNR ≥ 20dB, ≤ 5 clips
- P2 (Acceptable): SNR ≥ 15dB, ≤ 20 clips
- P3 (Poor): SNR ≥ 10dB, ≤ 50 clips
- P4 (Reject): SNR < 10dB or critical issues

> **Note**: Live metrics are stored in-memory on the server (per-pod, not
> shared). They are ephemeral estimates for real-time UI feedback. The
> definitive quality assessment comes from the external processing pipeline.

#### E. Upload Orchestration

After recording stops, each client's WAV blob is uploaded to S3. The server
never handles audio data — it only generates presigned URLs.

##### Strategy Selection

```
if (blob.size ≤ 10MB)  → Simple upload (single PUT)
if (blob.size > 10MB)  → Multipart upload (10MB parts, 3 concurrent)
                          Falls back to simple on any failure
```

##### Simple Upload Flow

```
Client                              Server                           S3
──────                              ──────                           ──
POST /api/upload/url ──────────────►
  { roomId, participantName,          uploadService.generateUploadUrl()
    sessionId, contentType }          → s3.generateS3Key(meetingId, name, '.wav', sessionId)
                                        Key: recordings/{meetingId}/{sessionId}/{name}_{ts}.wav
                                      → s3.getPresignedPutUrl(key, contentType, 900)
◄──────────────────────────────────
  { uploadUrl, key, bucket }

PUT blob → uploadUrl ──────────────────────────────────────────────► S3 stores file

POST /api/upload/complete ─────────►
  { roomId, participantName,          s3.getObjectMetadata(key)  → verify file exists
    key, sessionId }                  recordingRepo.createRecording({
                                        meetingId, recordingId, participantName,
                                        sessionId, filePath: key, status: 'completed'
                                      })
                                      pipelineService.triggerProcessingIfReady(roomId, sessionId)
◄──────────────────────────────────   → see "Processing Trigger" section below
  { success: true }
```

##### Multipart Upload Flow

```
Client                              Server                            S3
──────                              ──────                            ──

1. INITIATE
POST /api/multipart-upload/initiate ►
  { roomId, participantName,          s3.createMultipartUpload(key, contentType)
    contentType, fileSize }           → S3 returns uploadId
                                      recordingRepo.createRecording({
                                        ..., status: 'uploading', uploadId
                                      })
◄───────────────────────────────────
  { uploadId, key, expiresAt }

2. PART 1 (special — temp copy for WAV header patching)
POST /api/multipart-upload/part-1 ──►
  { uploadId }                        tempKey = temp_uploads/{uploadId}_part1.wav
                                      url = s3.getPresignedPutUrl(tempKey, ...)
◄───────────────────────────────────
  { url, tempKey }

PUT part1 → tempKey ──────────────────────────────────────────────► S3 stores temp copy
PUT part1 → multipart part 1 presigned URL ───────────────────────► S3 stores as part 1

3. PARTS 2..N (3 concurrent uploads, 10MB each)
POST /api/multipart-upload/part-url ►
  { key, uploadId, partNumber }       url = s3.getUploadPartUrl(key, uploadId, partNumber, 900)
◄───────────────────────────────────
  { url }

PUT partN → url ──────────────────────────────────────────────────► S3 stores as part N
  Extract ETag from response header

4. COMPLETE (server patches WAV header)
POST /api/multipart-upload/complete ►
  { key, uploadId, parts, roomId,     a. Fetch WAV header from temp copy:
    participantName, sessionId }         fetchS3Range(tempKey, 'bytes=0-43') → 44 bytes

                                      b. List all parts, sum sizes:
                                         listParts(key, uploadId) → totalSize

                                      c. Patch WAV header:
                                         bytes 4-7:   ChunkSize = totalSize - 8
                                         bytes 40-43: Subchunk2Size = totalSize - 44

                                      d. Re-upload patched Part 1:
                                         uploadPartBuffer(key, uploadId, 1, patchedBuffer)
                                         → new ETag for Part 1

                                      e. Update parts[0].ETag = new ETag

                                      f. completeMultipartUpload(key, uploadId, parts)
                                         → S3 assembles final file

                                      g. Update Recording: status='completed', s3Url=location
                                      h. triggerProcessingIfReady(roomId, sessionId)
◄───────────────────────────────────
  { success: true, location }
```

**Why Part 1 temp copy?** — When streaming a WAV file in parts, the client
writes the WAV header in Part 1 but doesn't know the final file size until all
parts are uploaded. The server reads the header from the temp copy, patches in
the correct `ChunkSize` and `Subchunk2Size`, then re-uploads the patched Part 1
before completing the multipart assembly.

##### Upload Resume Support

Upload state is persisted to IndexedDB after each part completes:

```
IndexedDB store: upload-state
Key: upload:{roomId}:{participantName}:{sessionId}
Value: {
  uploadId,       // S3 multipart upload ID
  key,            // S3 object key
  totalParts,     // Expected number of parts
  completedParts, // [{PartNumber, ETag}, ...]
  blobSize,       // Total file size
  createdAt
}

On retry:
  1. Check IndexedDB for saved upload state
  2. Verify with server: GET /api/multipart-upload/parts?key=...&uploadId=...
  3. Skip already-uploaded parts
  4. Resume from next incomplete part
  5. Clear IndexedDB state on completion
```

##### Upload Progress Events

```
After each part uploads successfully:
  Client emits UPLOAD_PROGRESS { percent, participantName }
  → Server relays to room (excluding sender)
  → Partner's UploadProgress component shows progress bar
```

#### Chat

Simple real-time messaging between participants. Messages are not persisted.

```
Client → Server:  chat-message { roomId, message, sender, role }
Server → Room:    chat-message { message, sender, role, timestamp }
                  (server adds ISO 8601 timestamp)
```

---

### Stage 4: Results Page (`/room/:roomId/results`)

**Component**: `Results.tsx` + `QualityBadge`

Post-session page for viewing quality results and downloading recordings.

#### Flow

```
On mount:
  1. GET /api/recordings/:meetingId → fetch recording list
  2. Connect Socket.IO, join room (for processing updates)
  3. Listen for processing events

While processing:
  Server pushes processing-status events from SQS consumer:
    { step, progress, estimatedTimeLeft }
    Steps: syncing → validating → classifying → preprocessing → complete

On completion:
  Server pushes processing-complete:
    { profile, metrics, variants, warnings }

  Display:
    - Quality profile badge (P0–P4)
    - Metrics grid: SNR, RMS, SRMR, overlap, speaker balance, echo, WVMOS
    - Download buttons for each recording

On rejection:
  Server pushes recording-rejected:
    { reason, suggestions }

Download:
  POST /api/recordings/:meetingId/:recordingId/download-url
    → Server generates 1-hour presigned GET URL
    → Opens in new tab for browser download
```

---

## 3. REST API Reference

### Meeting Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/meetings` | JWT | Create a new meeting |
| `GET` | `/api/meetings` | JWT | List all meetings |
| `GET` | `/api/meetings/:id` | Public | Get meeting by ID |
| `PATCH` | `/api/meetings/:id/status` | JWT | Update meeting status |
| `POST` | `/api/meetings/:id/assign-host` | Public | Race-safe host email assignment |
| `POST` | `/api/meetings/:id/assign-guest` | Public | Race-safe guest slot assignment |
| `DELETE` | `/api/meetings/:id` | JWT | Delete meeting |

### Upload Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/upload/url` | Public | Get presigned PUT URL (simple upload) |
| `POST` | `/api/upload/complete` | Public | Mark upload finished |

### Multipart Upload Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/multipart-upload/initiate` | Public | Start multipart upload |
| `POST` | `/api/multipart-upload/part-1` | Public | Get Part 1 temp presigned URL |
| `POST` | `/api/multipart-upload/part-url` | Public | Get presigned URL for part N |
| `POST` | `/api/multipart-upload/complete` | Public | Finalize + WAV header patch |
| `POST` | `/api/multipart-upload/abort` | Public | Cancel multipart upload |
| `GET` | `/api/multipart-upload/parts` | Public | List uploaded parts (for resume) |

### Recording Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/recordings/:meetingId` | Public | List recordings for meeting |
| `POST` | `/api/recordings/:meetingId/:recordingId/download-url` | Public | Get presigned download URL (1hr) |

### Other Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `GET` | `/api/stats` | JWT | Get global statistics |
| `GET` | `/health` | Public | Health check |

### Rate Limiting

| Limiter | Scope | Window | Max |
|---------|-------|--------|-----|
| `generalLimiter` | All routes | 60s | 100/IP |
| `multipartLimiter` | Part URL endpoints | 1s | 10/(IP+uploadId) |
| `initiateUploadLimiter` | Upload initiation | 60s | 100/IP |

---

## 4. Socket.IO Event Reference

### Event Names

```
SOCKET_EVENTS = {
  // Room Management
  JOIN_ROOM           'join-room'
  ROOM_STATE          'room-state'
  USER_JOINED         'user-joined'
  USER_LEFT           'user-left'
  PEER_RECONNECTED    'peer-reconnected'
  ROOM_FULL           'room-full'
  DUPLICATE_SESSION   'duplicate-session'

  // WebRTC Signaling
  OFFER               'offer'
  ANSWER              'answer'
  ICE_CANDIDATE       'ice-candidate'

  // Recording Control
  START_RECORDING     'start-recording'
  STOP_RECORDING      'stop-recording'
  RESUME_RECORDING    'resume-recording'

  // Chat
  CHAT_MESSAGE        'chat-message'

  // Audio Quality (Green Room)
  MIC_CHECK           'mic-check'
  MIC_STATUS          'mic-status'

  // Audio Metrics (Studio, during recording)
  AUDIO_METRICS       'audio-metrics'
  RECORDING_WARNING   'recording-warning'
  QUALITY_UPDATE      'quality-update'

  // Upload & Processing
  UPLOAD_PROGRESS     'upload-progress'
  RECORDINGS_UPDATED  'recordings-updated'
  PROCESSING_STATUS   'processing-status'
  PROCESSING_COMPLETE 'processing-complete'
  RECORDING_REJECTED  'recording-rejected'

  // Error
  ERROR               'error'
}
```

### Event Payloads

#### Room Management

**join-room** (Client → Server)
```typescript
{ roomId: string, role: 'host' | 'guest', userId: string, userEmail?: string }
```

**room-state** (Server → Client)
```typescript
{
  meeting: { meetingId, title, status, createdAt },
  participants: [{ socketId, userId, role, userEmail }],
  recordingState: { isRecording, startedAt, sessionId }
}
```

**user-joined** (Server → Room)
```typescript
{ userId, persistentId, role, userEmail, isReconnection: boolean }
```

**user-left** (Server → Room)
```typescript
{ userId, persistentId, role }
```

**peer-reconnected** (Server → Room)
```typescript
{ userId, newSocketId }
```

**room-full** / **duplicate-session** — No payload

#### WebRTC Signaling

**offer** (Client → Server → Target)
```typescript
// Client sends:        { target: socketId, sdp: RTCSessionDescription }
// Server relays as:    { sdp: RTCSessionDescription, sender: socketId }
```

**answer** — Same shape as offer

**ice-candidate** (Client → Server → Target)
```typescript
// Client sends:        { target: socketId, candidate: RTCIceCandidateInit }
// Server relays as:    { candidate: RTCIceCandidateInit, sender: socketId }
```

#### Recording Control

**start-recording** (Client → Server)
```typescript
{ roomId }
```

**start-recording** (Server → Room broadcast)
```typescript
{ sessionId }  // UUID generated by server
```

**stop-recording** (Client → Server)
```typescript
{ roomId }
```

**stop-recording** (Server → Room broadcast) — No payload

**resume-recording** (Server → reconnecting Client)
```typescript
{ startedAt: number, elapsedSeconds: number, sessionId }
```

#### Audio Quality

**mic-check** (Client → Server, every 1s)
```typescript
{ rms: number, peak: number, noiseFloor: number, isClipping: boolean }
```

**mic-status** (Server → Client)
```typescript
{ level: 'good'|'too-quiet'|'too-loud', noiseFloor: 'clean'|'noisy'|'unacceptable',
  clipping: boolean, suggestions: string[] }
```

**audio-metrics** (Client → Server, every 5s during recording)
```typescript
{ sessionId, timestamp, rms, peak, clipCount, silenceDuration, speechDetected }
```

**recording-warning** (Server → Room)
```typescript
{ type: string, speaker: string, message: string, severity: 'warning'|'critical' }
```

**quality-update** (Server → Room)
```typescript
{ estimatedProfile: 'P0'|'P1'|'P2'|'P3'|'P4', metrics: { avgRms, clipCount, overlapPercent } }
```

#### Upload & Processing

**upload-progress** (Client → Server, relayed to room)
```typescript
{ percent: number, participantName: string }
```

**processing-status** (Server → Room)
```typescript
{ step: 'syncing'|'validating'|'classifying'|'preprocessing'|'complete',
  progress: number, estimatedTimeLeft: number }
```

**processing-complete** (Server → Room)
```typescript
{ profile: 'P0'|...|'P4',
  metrics: { snr, rms, srmr, overlapPercent, speakerBalance, echoCorrelation, wvmos? },
  variants?: { asr, annotator },
  warnings: string[] }
```

**recording-rejected** (Server → Room)
```typescript
{ reason: string, suggestions: string[] }
```

---

## 5. DynamoDB Schema & Operations

### Table: `AudioStudio_Meetings`

**Key**: `meetingId` (HASH)

| Attribute | Type | Description |
|-----------|------|-------------|
| meetingId | S | UUID v4 (primary key) |
| title | S | Session title |
| hostName | S/null | Host display name |
| hostEmail | S/null | Assigned host email |
| guestName | S/null | Guest display name |
| guestEmail | S/null | Guest email |
| scheduledTime | S/null | ISO 8601 scheduled time |
| status | S | scheduled / active / recording / completed / cancelled |
| createdAt | S | ISO 8601 creation time |

**Key Operations**:
- `createMeeting()` — PutItem
- `getOrCreateMeeting()` — PutItem with `condition: attribute_not_exists(meetingId)`, fallback to GetItem
- `getMeeting()` — GetItem
- `getAllMeetings()` — Scan (admin only)
- `updateStatus()` — UpdateItem SET status
- `assignHostEmail()` — UpdateItem with condition `attribute_not_exists(hostEmail) OR hostEmail = :empty`
- `assignGuestEmail()` — UpdateItem with condition `attribute_not_exists(guestEmail) OR guestEmail = :empty`
- `deleteMeeting()` — DeleteItem

### Table: `AudioStudio_Sessions`

**Key**: `meetingId` (HASH) + `sessionId` (RANGE)

| Attribute | Type | Description |
|-----------|------|-------------|
| meetingId | S | Meeting partition |
| sessionId | S | `{userId}#{joinedAt}` |
| userId | S | Persistent user ID |
| userRole | S | host / guest |
| userEmail | S/null | User email |
| socketId | S | Current Socket.IO ID |
| joinedAt | S | ISO 8601 |
| leftAt | S/null | ISO 8601 |
| isActive | BOOL | Currently connected |

**GSIs**:
- **UserIndex**: `userId` (HASH) + `joinedAt` (RANGE) — reconnection lookup
- **SocketIndex**: `socketId` (HASH) + `joinedAt` (RANGE) — disconnect cleanup

**Key Operations**:
- `createSession()` — PutItem
- `findActiveByUserId()` — Query UserIndex with `isActive = true`
- `findBySocketId()` — Query SocketIndex
- `markSessionInactiveBySocketId()` — Query SocketIndex → UpdateItem
- `updateSocketId()` — UpdateItem SET socketId
- `getActiveSessionsByMeeting()` — Query by meetingId with filter `isActive = true`
- `getActiveSessionCount()` — Same query, count only

### Table: `AudioStudio_Recordings`

**Key**: `meetingId` (HASH) + `recordingId` (RANGE)

| Attribute | Type | Description |
|-----------|------|-------------|
| meetingId | S | Meeting partition |
| recordingId | S | `{sessionId}#{sanitizedName}` or `multipart#{name}#{ts}` |
| participantName | S | Display name |
| sessionId | S | Recording session ID |
| filePath | S | S3 key |
| s3Url | S/null | S3 location URL |
| uploadedAt | S | ISO 8601 |
| uploadId | S/null | S3 multipart upload ID |
| status | S | uploading / completed |

**GSI**:
- **UploadIndex**: `uploadId` (HASH) — find recording by multipart upload ID

**Key Operations**:
- `createRecording()` — PutItem
- `getRecordingsByMeeting()` — Query by meetingId
- `findByUploadId()` — Query UploadIndex
- `updateRecordingStatus()` — UpdateItem
- `getCompletedRecordingsForSession()` — Query with filter `status = completed AND sessionId = :sid`

### Table: `AudioStudio_RecordingState`

**Key**: `meetingId` (HASH)

| Attribute | Type | Description |
|-----------|------|-------------|
| meetingId | S | Meeting (one state per meeting) |
| isRecording | BOOL | Currently recording |
| startedAt | S/null | ISO 8601 recording start |
| startedBySocketId | S/null | Who started it |
| startedByUserId | S/null | Who started it |
| stoppedAt | S/null | ISO 8601 recording stop |
| sessionId | S/null | Active recording session UUID |

**Key Operations**:
- `getOrCreateDefault()` — GetItem, or conditional PutItem if not exists
- `startRecording()` — UpdateItem SET isRecording=true, startedAt, sessionId
- `stopRecording()` — UpdateItem SET isRecording=false, stoppedAt

### Table: `AudioStudio_GlobalStats`

**Key**: `statKey` (HASH) — singleton key: `"GLOBAL"`

| Attribute | Type | Description |
|-----------|------|-------------|
| statKey | S | Always "GLOBAL" |
| activeSessionCount | N | Connected users |
| activeRecordingCount | N | Rooms currently recording |
| activePairCount | N | Rooms with 2 participants |

**Key Operations** (all atomic ADD):
- `incrementActiveSession()` / `decrementActiveSession()`
- `incrementActiveRecording()` / `decrementActiveRecording()`
- `incrementActivePair()` / `decrementActivePair()`
- `getStats()` — GetItem

---

## 6. S3 Storage & Upload Pipelines

### Bucket Structure

```
{S3_BUCKET}/
├── recordings/
│   └── {meetingId}/
│       └── {sessionId}/
│           └── {sanitizedName}_{timestamp}.wav    ← final recordings
│       └── {sanitizedName}_{timestamp}.wav        ← recordings without sessionId
└── temp_uploads/
    └── {uploadId}_part1.wav                       ← temporary Part 1 for WAV header patching
```

### Key Generation

```typescript
// Final recording key
generateS3Key(meetingId, participantName, '.wav', sessionId?)
  → recordings/{meetingId}/{sessionId}/{sanitized}_{Date.now()}.wav
  → recordings/{meetingId}/{sanitized}_{Date.now()}.wav  (no session)

// Temp key for multipart Part 1
getTempS3Key(uploadId)
  → temp_uploads/{uploadId}_part1.wav
```

### Presigned URL Expiration

| Use | Duration | Why |
|-----|----------|-----|
| Upload (PUT) | 900s (15 min) | Short-lived — uploads happen immediately |
| Download (GET) | 3600s (1 hour) | Users may download later |

---

## 7. SQS Processing Pipeline

### Queue Architecture

```
                             SQS FIFO                        SQS Standard
Server                    Processing Queue              Results Queue              Server
──────                    ────────────────              ─────────────              ──────
                               ▲                             │
pipelineService               │                             │
.triggerProcessingIfReady() ──┘                             │
                                                            │
            External Audio Processing Pipeline              │
            (consumes from Processing Queue,                │
             publishes to Results Queue)                    │
                                                            ▼
                                              processingResultConsumer
                                                     .poll()
                                                       │
                                              notificationService
                                              .notifyProcessingComplete()
                                                       │
                                              Socket.IO → Client
```

### Processing Trigger Logic

```typescript
// Called after each upload completes
async function triggerProcessingIfReady(roomId, sessionId):
  1. recordingRepo.getCompletedRecordingsForSession(roomId, sessionId)
  2. If completedRecordings.length >= 2:
     → Both participants have uploaded

  3. Find host and guest recordings from the list

  4. Publish to SQS Processing Queue:
     ProcessSessionMessage = {
       action: 'process-session',
       roomId,
       sessionId,
       hostKey: hostRecording.filePath,    // S3 key
       guestKey: guestRecording.filePath,  // S3 key
       timestamp: Date.now()
     }

     messageGroupId: roomId           // In-order per room
     deduplicationId: roomId:sessionId // Prevent duplicate processing
```

### SQS Message Formats

**Processing Queue (Server → External Pipeline)**
```typescript
ProcessSessionMessage {
  action: 'process-session'
  roomId: string
  sessionId: string
  hostKey: string       // S3 key of host recording
  guestKey: string      // S3 key of guest recording
  timestamp: number
}
```

**Results Queue (External Pipeline → Server)**
```typescript
ProcessingResult {
  roomId: string
  sessionId: string
  status: 'completed' | 'rejected'
  profile: 'P0' | 'P1' | 'P2' | 'P3' | 'P4'
  metrics: {
    snr: number              // Signal-to-Noise Ratio (dB)
    rms: number              // Average RMS (dBFS)
    srmr: number             // Speech-to-Reverberation Modulation Ratio
    overlapPercent: number   // Speaker overlap %
    speakerBalance: number   // Balance between speakers
    echoCorrelation: number  // Echo detection
    wvmos?: number           // Perceptual quality score (optional)
  }
  variants?: {
    asr: string              // S3 key for ASR transcript
    annotator: string        // S3 key for annotator reference
  }
  rejectionReason?: string
  suggestions?: string[]
  processingTimeMs: number
}
```

### SQS Consumer (processingResultConsumer.ts)

```
Lifecycle:
  startConsumer() → called at server boot
    If SQS_RESULTS_QUEUE_URL not set → disabled (logs info, returns)
    Sets isRunning = true
    Starts poll loop

  poll() → recursive setTimeout chain
    Long-poll 20 seconds, up to 5 messages per batch
    For each message:
      Parse as ProcessingResult
      If roomId && sessionId present:
        notifyProcessingComplete(roomId, result)
          → If rejected: io.to(roomId).emit(RECORDING_REJECTED, ...)
          → If completed: io.to(roomId).emit(PROCESSING_COMPLETE, ...)
        deleteMessage(queueUrl, receiptHandle)
      On error: log, DON'T delete (message retries after visibility timeout)
    Schedule next poll after 1s cooldown

  stopConsumer() → called during graceful shutdown
    Sets isRunning = false, clears timer
```

---

## 8. WebRTC Signaling Flow

The server acts purely as a signaling relay. It forwards SDP offers/answers
and ICE candidates between peers. Audio flows directly peer-to-peer.

```
socket/signaling.ts:

  socket.on('offer', (data) => {
    io.to(data.target).emit('offer', { sdp: data.sdp, sender: socket.id });
  });

  socket.on('answer', (data) => {
    io.to(data.target).emit('answer', { sdp: data.sdp, sender: socket.id });
  });

  socket.on('ice-candidate', (data) => {
    io.to(data.target).emit('ice-candidate', { candidate: data.candidate, sender: socket.id });
  });
```

The server adds `sender: socket.id` to each relayed message so the receiver
knows who it came from. No SDP or ICE payload inspection is performed.

---

## 9. Audio Recording Pipeline

### Recording Architecture (Client-Side)

Each participant records their own microphone locally. The recording never
flows through WebRTC or the server — it's captured directly from the
`MediaStream` using the Web Audio API.

```
Preferred path (AudioWorklet):
  MediaStream → AudioContext → MediaStreamSourceNode → AudioWorkletNode
  AudioWorkletProcessor.process() receives Float32Array every ~23ms (1024 samples at 48kHz)

Fallback path (ScriptProcessor, for older browsers):
  MediaStream → AudioContext → MediaStreamSourceNode → ScriptProcessorNode
  onaudioprocess event receives Float32Array

Both paths:
  → chunks[] in-memory array
  → storageService.saveChunk() to IndexedDB (fire-and-forget, non-blocking)
```

### IndexedDB Persistence

**Database**: `audio-studio` (version 1)

**Store: `recording-chunks`**
```
id:          auto-increment (primary key)
sessionKey:  string (indexed) — "roomId:userId:sessionId"
chunkIndex:  number — sequential ordering
data:        ArrayBuffer — Float32Array audio samples
timestamp:   number — Date.now()
```

**Store: `upload-state`**
```
sessionKey:     string (primary key) — "upload:roomId:participantName:sessionId"
uploadId:       string — S3 multipart upload ID
key:            string — S3 object key
totalParts:     number
completedParts: [{PartNumber, ETag}]
blobSize:       number
createdAt:      number
```

---

## 10. Audio Metrics & Quality Monitoring

### Computed Metrics (Client, ~60fps)

| Metric | Formula | Unit |
|--------|---------|------|
| RMS | `20 * log10(sqrt(sum(s²) / N))` | dBFS |
| Peak | `20 * log10(max(\|sample\|))` | dBFS |
| ClipCount | samples where `\|value\| ≥ 0.99` | count |
| SilenceDuration | cumulative time below -50 dBFS | ms |
| SpeechDetected | `RMS > -50 dBFS` | boolean |

### Server Threshold Evaluation

| Condition | Threshold | Result |
|-----------|-----------|--------|
| RMS < -40 dBFS | `MIC_TOO_QUIET` | `level: 'too-quiet'` |
| RMS > -6 dBFS | `MIC_TOO_LOUD` | `level: 'too-loud'` |
| Noise floor > -30 dBFS | `NOISE_FLOOR_REJECT` | `noiseFloor: 'unacceptable'` |
| Noise floor > -35 dBFS | `NOISE_FLOOR_NOISY` | `noiseFloor: 'noisy'` |
| clipCount ≥ 5 | `CLIP_WARNING_COUNT` | warning severity |
| silence ≥ 30s | `SILENCE_WARNING_MS` | long-silence warning |

### Quality Profiles

| Profile | SNR | Description |
|---------|-----|-------------|
| P0 | ≥ 25 dB | Pristine — studio quality |
| P1 | ≥ 20 dB | Good — high quality |
| P2 | ≥ 15 dB | Acceptable — usable |
| P3 | ≥ 10 dB | Poor — marginal |
| P4 | < 10 dB | Reject — unusable |

---

## 11. Race Condition Handling

### Host/Guest Assignment (DynamoDB Conditional Writes)

```typescript
assignHostEmail(meetingId, email):
  UpdateCommand with ConditionExpression:
    'attribute_not_exists(hostEmail) OR hostEmail = :empty'

  Two simultaneous requests:
    First:  condition passes → write succeeds → returns true
    Second: condition fails → ConditionalCheckFailedException → returns false

  Atomicity guaranteed by DynamoDB.
```

### Meeting Auto-Creation on Socket Join

```typescript
getOrCreateMeeting(meetingId):
  PutCommand with ConditionExpression: 'attribute_not_exists(meetingId)'

  Two simultaneous joins for new meeting:
    First:  condition passes → meeting created
    Second: condition fails → catches exception → fetches existing meeting

  Both requests use the same meeting.
```

### Ghost Socket Cleanup (Reconnection)

```
User opens meeting in new tab (same userId, new socketId):
  1. Server detects existing active session for userId
  2. Old socket = "ghost"
  3. Emit DUPLICATE_SESSION to old socket
  4. Force disconnect old socket: oldSocket.disconnect(true)
  5. Wait 800ms (GHOST_SOCKET_DELAY_MS) for adapter cleanup
  6. Update session's socketId in DynamoDB
  7. Continue with new socket

The 800ms delay is critical:
  Without it, both sockets exist in the room briefly → duplicate events
```

### Recording State (Singleton per Meeting)

```
RecordingState table: one row per meetingId
  Only one recording session active at a time
  startRecording() sets isRecording=true
  stopRecording() sets isRecording=false
  getOrCreateDefault() uses conditional put to avoid creation races
```

---

## 12. Error Handling Strategy

### Custom Error Classes

```typescript
class AppError extends Error        { statusCode, code }
class ValidationError extends AppError  { 400, 'VALIDATION_ERROR' }
class NotFoundError extends AppError    { 404, 'NOT_FOUND' }
class ConflictError extends AppError    { 409, 'CONFLICT' }
class RateLimitError extends AppError   { 429, 'RATE_LIMIT_EXCEEDED' }
```

### Error Handler Middleware

```
Route handlers:  throw new NotFoundError('Meeting not found')
                     ↓
errorHandler:    if (err instanceof AppError)
                   → res.status(err.statusCode).json({ error: err.message, code: err.code })
                 else
                   → log full error details
                   → res.status(500).json({ error: 'Internal server error', code: 'INTERNAL_ERROR' })
                   (prevents leaking implementation details)
```

### Socket.IO Errors

```
socket.emit(SOCKET_EVENTS.ERROR, { message: 'Human-readable error' })
  Used when operation fails (e.g., recording start fails)
  Client displays in error banner
```

### Process-Level Error Boundaries (server.ts)

```
unhandledRejection  → log, don't crash (may be transient)
uncaughtException   → log, exit code 1 (unrecoverable)
bootstrap failure   → log, exit code 1
```

### Client-Side Error Handling

- `ErrorBoundary` wraps the entire React app — catches render errors
- Each page has local error state displayed in banners
- Upload failures display error message with no auto-retry
- Socket disconnections trigger auto-reconnect (up to 5 attempts)

---

## 13. Reconnection & Crash Recovery

### Socket.IO Reconnection

```
Socket.IO client config:
  reconnection: true
  reconnectionAttempts: 5
  reconnectionDelay: 1000ms
  reconnectionDelayMax: 5000ms

Flow:
  1. Connection drops (WiFi lost, server restart)
  2. Client auto-reconnects with new socketId
  3. Re-emits join-room with same userId
  4. Server detects reconnection (findActiveByUserId)
  5. Updates socketId in DynamoDB
  6. Broadcasts PEER_RECONNECTED to room
  7. Partner tears down old WebRTC, creates new connection
  8. New offer/answer/ICE exchange
  9. Audio restored
  10. Recording continues uninterrupted (local recording not affected by WebRTC)
```

### Recording Crash Recovery

```
During recording:
  Every audio chunk → IndexedDB (fire-and-forget)

After crash/refresh:
  1. Studio mounts
  2. storageService.getPendingRecordings() checks IndexedDB
  3. If orphaned chunks found → display recovery banner
  4. User clicks "Recover & Upload"
  5. recorderService.recover(sessionKey)
     → Read all chunks from IndexedDB
     → Sort by chunkIndex
     → Encode to WAV blob
  6. Upload WAV normally
  7. Clear IndexedDB chunks
```

### Upload Resume

```
During multipart upload:
  After each part completes → save state to IndexedDB

After interruption:
  1. Check IndexedDB for saved upload state
  2. Verify with server: GET /api/multipart-upload/parts
  3. Skip already-uploaded parts
  4. Resume from next incomplete part
  5. Clear state on completion
```

---

## 14. Configuration & Environment Variables

### Server Environment

```bash
# Server
PORT=4000                                    # Express listen port
ENV=development|stage|production             # Environment name
CORS_ORIGINS=http://localhost:5173           # Comma-separated allowed origins

# AWS
AWS_REGION=ap-south-1                        # Default region
AWS_ACCESS_KEY_ID=test                       # Explicit creds (dev only)
AWS_SECRET_ACCESS_KEY=test                   # IAM role in prod

# DynamoDB
DYNAMODB_ENDPOINT=http://localhost:4566      # LocalStack (dev only)
DYNAMO_TABLE_MEETINGS=stage-AudioStudio_Meetings
DYNAMO_TABLE_SESSIONS=stage-AudioStudio_Sessions
DYNAMO_TABLE_RECORDINGS=stage-AudioStudio_Recordings
DYNAMO_TABLE_RECORDING_STATE=stage-AudioStudio_RecordingState
DYNAMO_TABLE_STATS=stage-AudioStudio_GlobalStats

# S3
AWS_ENDPOINT=http://localhost:4566           # LocalStack (dev only)
S3_BUCKET=stage-audio-studio-recordings

# SQS
SQS_ENDPOINT=http://localhost:4566           # LocalStack (dev only)
SQS_PROCESSING_QUEUE_URL=...                 # FIFO queue URL
SQS_RESULTS_QUEUE_URL=...                    # Standard queue URL

# Redis (optional — for multi-pod Socket.IO)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=                              # Optional

# Auth
JWT_SECRET=dev-secret-key-not-for-production

# Production only
APP_NAME=audio-studio-prod                   # For Secrets Manager lookup
```

### Frontend Environment (Vite)

```bash
VITE_SERVER_URL=                             # Socket.IO URL (empty = same-origin)
VITE_API_URL=/api                            # REST API base URL

# WebRTC TURN (optional)
VITE_TURN_URL=turn:turn.example.com:3478
VITE_TURN_USERNAME=user
VITE_TURN_CREDENTIAL=pass
```

### Configuration Loading Order

```
1. server/src/env.ts runs first (imported at top of server.ts)
   → dotenv.config() loads .env file into process.env

2. All infra modules (dynamodb.ts, s3.ts, sqs.ts) initialize with env vars

3. bootstrap() calls loadConfig()
   → In dev: no-op (env already loaded)
   → In stage/prod: overlays AWS Secrets Manager values onto process.env
```

---

## 15. Constants & Thresholds

### Business Limits (`shared/constants/limits.ts`)

```
MAX_PARTICIPANTS:     2          # Max users per meeting
MAX_FILE_SIZE:        5 GB       # Max upload size
MIN_PART_SIZE:        5 MB       # S3 multipart minimum
MAX_PART_SIZE:        100 MB     # S3 multipart maximum
MAX_PARTS:            10,000     # S3 max parts per upload

PRESIGNED_URL_EXPIRY: 3600s      # Download URL lifetime (1 hour)
UPLOAD_URL_EXPIRY:    900s       # Upload URL lifetime (15 min)

GHOST_SOCKET_DELAY_MS: 800ms     # Wait after disconnecting ghost socket
SOCKET_PING_INTERVAL:  10s       # Socket.IO ping frequency
SOCKET_PING_TIMEOUT:   15s       # Socket.IO disconnect after no pong

TITLE_MAX_LENGTH:     255
NAME_MAX_LENGTH:      255

ALLOWED_CONTENT_TYPES: [
  'audio/webm', 'audio/mp3', 'audio/wav', 'audio/ogg',
  'video/webm', 'video/mp4'
]
```

### Audio Thresholds (`shared/constants/thresholds.ts`)

```
# Mic Check (Green Room)
MIC_TOO_QUIET:       -40 dBFS
MIC_TOO_LOUD:        -6 dBFS
NOISE_FLOOR_GOOD:    -45 dBFS
NOISE_FLOOR_NOISY:   -35 dBFS
NOISE_FLOOR_REJECT:  -30 dBFS

# Recording Quality (Studio)
CLIP_WARNING_COUNT:     5 clips
SILENCE_WARNING_MS:     30,000 ms
SILENCE_THRESHOLD:      -50 dBFS
OVERLAP_WARNING_PCT:    20%
TOO_QUIET_DURATION_MS:  10,000 ms

# Quality Profile SNR Thresholds
P0_SNR_MIN:  25 dB   (Pristine)
P1_SNR_MIN:  20 dB   (Good)
P2_SNR_MIN:  15 dB   (Acceptable)
P3_SNR_MIN:  10 dB   (Poor)

# Target Levels
TARGET_RMS_MIN:  -26 dBFS
TARGET_RMS_MAX:  -20 dBFS
TARGET_LUFS:     -23 LUFS
```
