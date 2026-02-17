# Recording Flow Audit — Comprehensive Report

> Audit date: 2026-02-17
> Scope: End-to-end recording flow from Home → GreenRoom → Studio → Results, including all subsystems (Socket.IO, WebRTC, AudioWorklet recording, upload, server handlers, DynamoDB, S3).

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [End-to-End Flow](#2-end-to-end-flow)
3. [Subsystem Deep Dives](#3-subsystem-deep-dives)
4. [Bugs & Issues Found](#4-bugs--issues-found)
5. [Multi-Pod (EKS) Concerns](#5-multi-pod-eks-concerns)
6. [Recommended Fixes by Priority](#6-recommended-fixes-by-priority)

---

## 1. Architecture Overview

```
┌─────────────┐     ┌─────────────┐
│  Browser A   │     │  Browser B   │
│  (Host)      │     │  (Guest)     │
│              │     │              │
│ AudioWorklet │     │ AudioWorklet │   ← Local WAV recording (48kHz 16-bit PCM)
│ WebRTC  ◄────┼─────┼────► WebRTC │   ← P2P audio for live monitoring
│ Socket.IO ◄──┼─────┼──► Socket.IO│   ← Signaling + room events
└──────┬───────┘     └──────┬──────┘
       │                    │
       │  REST (presigned)  │
       ▼                    ▼
┌──────────────────────────────────┐
│          S3 Bucket               │   ← Direct browser→S3 upload via presigned URLs
│  recordings/{meetingId}/...      │
└──────────────────────────────────┘
       ▲
       │ presigned URL generation
┌──────┴───────────────────────────┐
│         Node.js Server           │
│                                  │
│  Socket.IO ─┬─ session.ts       │   ← Room join, participant management
│             ├─ signaling.ts      │   ← WebRTC relay (offer/answer/ICE)
│             ├─ recording.ts      │   ← Start/stop recording control
│             ├─ liveMetrics.ts    │   ← Audio quality monitoring
│             └─ greenRoom.ts      │   ← Pre-recording mic checks
│                                  │
│  REST ──────┬─ upload.ts         │   ← Simple upload (<10MB)
│             └─ multipartUpload.ts│   ← Multipart upload (>10MB)
│                                  │
│  Services ──┬─ meetingService    │
│             ├─ metricsService    │   ← In-memory quality aggregation
│             └─ uploadService     │   ← S3 operations + WAV header patching
│                                  │
│  Repos ─────┬─ sessionRepo      │   ← DynamoDB: active connections
│             ├─ meetingRepo       │   ← DynamoDB: meeting metadata
│             ├─ recordingRepo     │   ← DynamoDB: recording status tracking
│             ├─ recordingStateRepo│   ← DynamoDB: is room recording?
│             └─ statsRepo         │   ← DynamoDB: global counters
└──────────────────────────────────┘
       │              │
       ▼              ▼
   DynamoDB        Redis
   (sessions,      (Socket.IO adapter
    meetings,       for multi-pod)
    recordings)
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Local recording, not server-side** | Each participant records their own mic locally → lossless 48kHz WAV. WebRTC is only for live monitoring, not capture. |
| **AudioWorklet over MediaRecorder** | AudioWorklet gives raw PCM Float32 samples, enabling precise control over encoding. MediaRecorder produces compressed formats with browser-specific variations. |
| **Direct S3 upload via presigned URLs** | Server generates URLs, browser uploads directly to S3. Avoids routing 100MB+ WAV files through the Node.js server. |
| **DynamoDB for sessions** | Supports multi-pod EKS deployment — all pods share session state. |
| **Socket.IO singleton** | Single connection per browser tab, shared across pages. Prevents the server from seeing one user as multiple participants. |
| **IndexedDB crash recovery** | Every audio chunk is persisted to IndexedDB as a fire-and-forget write. If the browser crashes, chunks can be recovered and re-encoded. |

---

## 2. End-to-End Flow

### Phase 1: Home Page
```
User → Home.tsx
  ├─ "Create Session" → POST /api/meetings → meetingId UUID → navigate to /room/{id}/green-room
  └─ "Join Session"   → paste meetingId    → navigate to /room/{id}/green-room
```

### Phase 2: Green Room (Mic Check)
```
GreenRoom.tsx mounts
  → connectSocket() → getSocket() singleton
  → getUserMedia({ audio: { deviceId, echoCancellation:false, noiseSuppression:false, sampleRate:48000 }})
  → startMetrics(stream) → AnalyserNode → requestAnimationFrame loop

3-Phase Validation:
  Step 1 (Device):  Select mic → acquire stream
  Step 2 (Level):   Speak → RMS must reach "good" + speechVerified for 5 consecutive good frames
  Step 3 (Environment): Check noise floor, SNR, spectral warnings (hum, muffled)

Each tick:
  → computeMetrics(timeDomainData) → RMS, peak, clip, silence, stability
  → computeSpectralMetrics(freqData) → voiceBandEnergy, highFreqEnergy, spectralFlatness, humDetected, speechLikely
  → EMA smoothing (attack α=0.3, release α=0.08)
  → emit MIC_CHECK to server → server evaluates → MIC_STATUS back

"Ready" clicked:
  → navigatingToStudioRef = true (prevents socket disconnect on unmount)
  → stopMetrics(), stop stream tracks
  → navigate to /room/{id} (Studio)
```

### Phase 3: Studio (Recording)
```
Studio.tsx mounts
  → connectSocket() → socket already connected (singleton from GreenRoom)
  → socket.connected === true → setIsConnected(true) immediately
  → getUserMedia({ audio: { echoCancellation:false, noiseSuppression:false, sampleRate:48000 }})
  → startMetrics(stream)
  → joinRoom() emitted when isConnected && localStream both true

Server handles join-room:
  → Duplicate join guard (same socket + same room → re-send state)
  → findAllActiveByUserId() → clean up stale sessions
  → Capacity check (max 2 participants)
  → Server assigns role: first joiner = host, second = guest
  → Create DynamoDB session → join Socket.IO room
  → Broadcast user-joined to room → send room-state back

WebRTC setup (when peer joins):
  → Existing user receives user-joined event
  → initConnection() → new RTCPeerConnection → add local tracks
  → createOffer() → setLocalDescription → emit 'offer' via server relay
  → New user receives offer → createPeerConnection → setRemoteDescription
  → flushCandidateQueue() → createAnswer → setLocalDescription → emit 'answer'
  → ICE candidates exchanged via server relay with queuing for race conditions
  → ontrack → remoteStream → <audio autoPlay> for live monitoring

Recording flow:
  1. Host clicks "Start Recording"
  2. Client emits start-recording { roomId }
  3. Server generates sessionId (UUID) → writes to DynamoDB RecordingState
  4. Server broadcasts start-recording { sessionId } to all in room
  5. Both clients:
     → setSessionId(data.sessionId)
     → recorder.start(localStream, `roomId:userId:sessionId`)
     → AudioContext(48kHz) → AudioWorklet → Float32Array chunks → memory + IndexedDB
  6. Every 5s: client emits audio-metrics { rms, peak, clipCount, silenceDuration }
  7. Server aggregates metrics → broadcasts recording-warning / quality-update
  8. Host clicks "Stop Recording"
  9. Client emits stop-recording { roomId }
  10. Server broadcasts stop-recording to all
  11. Both clients:
      → recorder.stop() → encode WAV (Float32→Int16, RIFF header)
      → upload.upload(blob, roomId, userId, sessionId)

Upload flow:
  If blob ≤ 10MB → Simple upload:
    → POST /api/upload/url → presigned PUT URL (15min expiry)
    → PUT blob to S3 directly
    → POST /api/upload/complete → DynamoDB recording status = 'completed'

  If blob > 10MB → Multipart upload:
    → Check IndexedDB for resumable state
    → POST /api/multipart-upload/initiate → uploadId + key
    → Part 1: upload to temp location (for WAV header) + actual multipart Part 1
    → Parts 2-N: parallel upload (3 concurrent) with presigned URLs
    → POST /api/multipart-upload/complete → server patches WAV header → DynamoDB status
    → Fallback: if multipart fails → simple upload

  12. Server emits upload-progress to room for partner visibility
```

### Phase 4: Results
```
Results.tsx mounts
  → connectSocket() → join room
  → Fetch recording status, download links
  → Display quality profile, allow downloads
```

---

## 3. Subsystem Deep Dives

### 3.1 Socket.IO Connection Management

**Singleton Pattern** ([socketService.ts](web/src/services/socketService.ts)):
- Single `io()` instance shared across all pages
- `autoConnect: false` — caller controls lifecycle
- WebSocket preferred, polling fallback
- Reconnection: up to 5 attempts, 1-5s exponential backoff

**Page Lifecycle**:
- GreenRoom: `connectSocket()` on mount, skip `disconnectSocket()` when navigating to Studio
- Studio: reuses connected socket, `disconnectSocket()` on unmount
- Results: fresh `connectSocket()` on mount, `disconnectSocket()` on unmount

**Stale Closure Fix** ([useSocket.ts](web/src/hooks/useSocket.ts)):
- All callbacks stored in `callbacksRef` (updated every render)
- Socket event listeners call through `callbacksRef.current` → always latest closure
- Solves: `localStream` and `socket` being null in callbacks registered at mount time

### 3.2 WebRTC Signaling & Connection

**Server**: Pure relay — forwards `offer`, `answer`, `ice-candidate` by target socket ID. No SFU/MCU.

**ICE Candidate Queuing** ([webrtcService.ts](web/src/services/webrtcService.ts)):
- Candidates arriving before `setRemoteDescription()` are queued in a `Map<RTCPeerConnection, RTCIceCandidateInit[]>`
- `flushCandidateQueue()` called after `setRemoteDescription()` succeeds
- Each candidate add is individually try/caught so one bad candidate doesn't block the rest

**Reconnection**: When `peer-reconnected` fires, old PeerConnection is torn down and a new one created targeting the new socket ID.

### 3.3 AudioWorklet Recording Pipeline

**Pipeline** ([recorderService.ts](web/src/services/recorderService.ts)):
```
MediaStream → AudioContext (48kHz)
            → MediaStreamSource
            → AudioWorkletNode ('audio-recorder-processor')
                → port.onmessage → Float32Array chunks
                    → state.chunks[] (memory)
                    → storeChunk() (IndexedDB, fire-and-forget)
```

**Fallback**: If AudioWorklet fails (file not found, browser doesn't support), falls back to deprecated `ScriptProcessor` with 4096 buffer size. Silent fallback — no user notification.

**WAV Encoding** (`encodeWAV()`):
- Float32 [-1,1] → Int16 [-32768, 32767] with clamping
- RIFF/WAV header (44 bytes) + PCM data
- Memory: total ~2x the recording size during encoding (chunks + final buffer)

**Recovery**: IndexedDB stores each chunk with `(sessionKey, chunkIndex)`. On recovery, chunks are read in order, re-encoded to WAV, and uploaded normally.

### 3.4 Upload Pipeline

**Simple Upload** (<10MB) ([uploadService.ts](web/src/services/uploadService.ts)):
1. `POST /api/upload/url` → presigned PUT URL (15-minute expiry)
2. `PUT` blob directly to S3
3. `POST /api/upload/complete` → DynamoDB recording marked complete

**Multipart Upload** (>10MB):
1. Check IndexedDB for resumable state (matches by `blobSize`)
2. `POST /api/multipart-upload/initiate` → uploadId + S3 key
3. Part 1 → uploaded to temp location AND actual multipart location
4. Parts 2-N → parallel upload (3 concurrent, `runWithConcurrency`)
5. `POST /api/multipart-upload/complete` → server patches WAV header (correct file size in bytes 4-7 and 40-43), then completes S3 multipart
6. Clear resumable state from IndexedDB

**WAV Header Patching**: Part 1 contains the WAV header (44 bytes). The header's ChunkSize and Subchunk2Size fields must reflect the *total* file size. Server fetches Part 1 from temp location, patches the sizes, re-uploads as the actual Part 1, then calls `CompleteMultipartUpload`.

### 3.5 Server Session Management

**DynamoDB Tables**:
- `Sessions` — active socket connections (PK: meetingId, SK: sessionId=`userId#timestamp`)
- `Meetings` — meeting metadata (PK: meetingId)
- `RecordingState` — per-room recording status (PK: meetingId)
- `Recordings` — individual recording files (PK: meetingId, SK: recordingId)
- `Stats` — global counters (active sessions, recordings, meetings)

**Join-Room Flow** ([session.ts](server/src/socket/session.ts)):
1. Duplicate join guard (same socket already in room → re-send state, return)
2. `findAllActiveByUserId()` — find ALL active sessions for this user (GSI query)
3. Clean up sessions in other rooms (mark inactive)
4. Detect reconnection (active session in same room) → ghost socket cleanup (800ms delay)
5. Capacity check: max 2 active participants per room
6. Role assignment: `activeCount === 0 ? 'host' : 'guest'` (server-enforced)
7. Create DynamoDB session → join Socket.IO room → broadcast

### 3.6 Live Metrics & Quality Monitoring

**Client → Server** (every 5s during recording):
```json
{ "sessionId", "timestamp", "rms", "peak", "clipCount", "silenceDuration", "speechDetected" }
```

**Server Processing** ([metricsService.ts](server/src/services/metricsService.ts)):
- In-memory `Map<string, RoomMetricsAggregate>` — NOT persisted
- Running averages per speaker (incremental mean calculation)
- Warning triggers: clipping (>5 clips/batch), silence (>15s), peak (>-1dB)
- Quality profile estimation (P0=excellent → P4=unusable)
- Broadcasts `recording-warning` and `quality-update` to room

---

## 4. Bugs & Issues Found

### CRITICAL

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| C1 | **Metrics interval recreated 60x/sec** | [Studio.tsx:379-395](web/src/pages/Studio.tsx#L379-L395) | `metrics` in dependency array changes every animation frame → `setInterval` created/destroyed 60 times per second. Memory leak, excessive event listener churn. |
| C2 | **Double start-recording race** | [recording.ts:33-66](server/src/socket/recording.ts#L33-L66) | No conditional write. Two pods can both generate different sessionId UUIDs for the same room. Host uploads with UUID-A, guest with UUID-B → recordings never linked. |
| C3 | **Ghost socket cleanup broken multi-pod** | [session.ts:108-120](server/src/socket/session.ts#L108-L120) | `io.sockets.sockets.get(oldSocketId)` only finds sockets on the local pod. Cross-pod ghost sockets persist in Redis room → duplicate audio. |
| C4 | **Metrics memory leak (no cleanup)** | [liveMetrics.ts](server/src/socket/liveMetrics.ts) | `metricsService.cleanupRoom()` is never called. Abandoned room metrics accumulate in memory indefinitely → eventual OOM on long-running pods. |

### HIGH

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| H1 | **GreenRoom → Studio device mismatch** | [GreenRoom.tsx:124](web/src/pages/GreenRoom.tsx#L124) vs [Studio.tsx:333](web/src/pages/Studio.tsx#L333) | GreenRoom requests specific `deviceId: { exact: deviceId }`. Studio requests default device (no deviceId). User could test USB mic in GreenRoom, but Studio records laptop mic. |
| H2 | **WAV header patching fails silently** | [uploadService.ts:143-170](server/src/services/uploadService.ts#L143-L170) | Catch block logs warning but continues → Part 1 stays unpatched → WAV file has wrong ChunkSize → file appears corrupted but marked 'completed' in DynamoDB. |
| H3 | **Silence tracking not reset between recordings** | [metricsService.ts:57-58](web/src/services/metricsService.ts#L57-L58) | `stopMetrics()` doesn't call `resetMetrics()`. If user records, stops, then records again without page navigation, silenceDuration accumulates from previous recording. |
| H4 | **Race condition on capacity check** | [session.ts:75-155](server/src/socket/session.ts#L75-L155) | No conditional DynamoDB write during join. Two users on different pods can both pass `activeCount < 2` check simultaneously → 3 participants in a 2-person room. |
| H5 | **Stats counters can go negative** | [statsRepo.ts](server/src/repositories/statsRepo.ts) | `decrementActiveSession()` blindly adds -1. If disconnect fires twice for same socket (network retry), counter goes negative → dashboard shows -1 active sessions. |

### MEDIUM

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| M1 | **AudioWorklet fallback is silent** | [recorderService.ts:117-142](web/src/services/recorderService.ts#L117-L142) | If `/audio-recorder-worklet.js` missing, falls back to deprecated ScriptProcessor without logging or user notification. User doesn't know they're on the inferior path. |
| M2 | **Upload progress not reset on fallback** | [uploadService.ts:115-121](web/src/services/uploadService.ts#L115-L121) | Multipart fails at 30% → falls back to simple upload. Progress jumps from 30% to 100% without resetting. Confusing UX. |
| M3 | **Presigned URL 15-min expiry not handled** | [uploadService.ts](web/src/services/uploadService.ts) | If upload takes >15 minutes on slow connection, S3 rejects the PUT. No retry with fresh URL. |
| M4 | **Recording status eventual consistency** | [uploadService.ts:176-188](server/src/services/uploadService.ts#L176-L188) | `recordingRepo.findByUploadId()` after S3 complete may return null if DynamoDB hasn't replicated yet. Recording stays 'uploading' forever → processing pipeline never triggers. |
| M5 | **No validation that meeting exists for upload** | Upload routes | Client can upload to any roomId without validating the meeting was ever created. Could create orphaned recordings. |
| M6 | **IndexedDB chunk persistence fire-and-forget** | [recorderService.ts:111-114](web/src/services/recorderService.ts#L111-L114) | Failed IndexedDB writes logged as warning, recording continues. On crash, recovery is partial (only chunks that succeeded). |
| M7 | **No rate limiting on signaling events** | [signaling.ts](server/src/socket/signaling.ts) | Malicious client can spam unlimited ICE candidates. No per-socket throttle. |
| M8 | **Memory spike during WAV encoding** | [recorderService.ts](web/src/services/recorderService.ts) | 1-hour recording at 48kHz ≈ 344MB chunks + 344MB WAV buffer = ~700MB peak. Risky on devices with limited memory. |
| M9 | **No validation on stop-recording** | [recording.ts:69-91](server/src/socket/recording.ts#L69-L91) | No check that recording is actually active before stopping. Double-click could decrement stats counter twice. |

### LOW

| # | Issue | Location | Impact |
|---|-------|----------|--------|
| L1 | **DeviceSelector missing useEffect dependency** | DeviceSelector.tsx | `selectedDeviceId` not in deps array. Auto-select condition stale after parent update. Low risk: GreenRoom passes memoized callback. |
| L2 | **Session ID timestamp collision** | [session.ts:167](server/src/socket/session.ts#L167) | `userId#ISOTimestamp` — same user joining twice in <1ms creates collision. Extremely unlikely in practice. |
| L3 | **clipCount and silenceDuration are cumulative** | [Studio.tsx:379-395](web/src/pages/Studio.tsx#L379-L395) | Sent every 5s but values accumulate from session start. Server must track deltas. Current server code uses raw values — may overcount. |
| L4 | **Stale ICE candidates after reconnection** | [webrtcService.ts](web/src/services/webrtcService.ts) | Old candidates for closed PeerConnection arrive after reconnection. Fail silently (console warnings) but don't crash. |

---

## 5. Multi-Pod (EKS) Concerns

### What Works

| Component | Multi-Pod Safe? | Mechanism |
|-----------|----------------|-----------|
| Session tracking | Yes | DynamoDB (shared state) |
| Meeting management | Yes | DynamoDB with conditional writes |
| Recording state | Mostly | DynamoDB, but see C2 (race condition) |
| Socket.IO events | Yes | Redis adapter for cross-pod broadcasting |
| S3 uploads | Yes | Presigned URLs are pod-independent |
| WebRTC signaling | Yes | Relayed via Socket.IO (Redis adapter handles cross-pod) |

### What Doesn't Work

| Component | Issue | Impact |
|-----------|-------|--------|
| Ghost socket cleanup (C3) | `io.sockets.sockets.get()` is pod-local | Reconnecting user on Pod B can't disconnect ghost on Pod A → duplicate in Redis room |
| Metrics service (C4) | In-memory `Map` per pod | Quality estimates inconsistent across pods. Pod restart loses all accumulated data. |
| Start-recording (C2) | No conditional write | Two pods can generate different sessionIds for same room |
| Capacity check (H4) | Read-then-write pattern | Two pods can both read `activeCount=1` and both allow a join → 3 people |

### Recommended Multi-Pod Architecture Improvements

1. **Ghost cleanup**: Track `{socketId → podId}` in DynamoDB. On reconnection, send a `disconnect-ghost` event to the Redis pub/sub channel → target pod handles its own local socket disconnect.

2. **Metrics service**: Accept that metrics are ephemeral per-pod. Quality profile should come from the deterministic post-processing pipeline, not live estimates. Document this clearly.

3. **Start-recording**: Use DynamoDB conditional write: `PutCommand({ ConditionExpression: 'isRecording = :false' })`. On `ConditionalCheckFailedException`, fetch existing sessionId instead of generating a new one.

4. **Capacity check**: Use DynamoDB atomic counter or conditional write to enforce max participants.

---

## 6. Recommended Fixes by Priority

### Fix Now (Before Next Recording Session)

**1. Metrics interval recreation (C1)**
```
Location: web/src/pages/Studio.tsx:379-395
Fix: Remove `metrics` from the useEffect dependency array.
     Use a metricsRef to read latest metrics inside setInterval.
```

**2. Device mismatch GreenRoom → Studio (H1)**
```
Location: web/src/pages/Studio.tsx:333
Fix: Pass selected deviceId from GreenRoom via URL search param or localStorage.
     Studio reads it and passes { deviceId: { exact: savedId } } to getUserMedia.
```

### Fix Before Production

**3. Double start-recording race (C2)**
```
Location: server/src/socket/recording.ts
Fix: Use conditional DynamoDB write (isRecording = false).
     On ConditionalCheckFailedException, fetch existing sessionId.
```

**4. Ghost cleanup for multi-pod (C3)**
```
Location: server/src/socket/session.ts
Fix: Track socket-to-pod mapping. Publish disconnect request via Redis pub/sub.
```

**5. Metrics memory leak (C4)**
```
Location: server/src/socket/liveMetrics.ts
Fix: Call metricsService.cleanupRoom() in stop-recording handler.
     Add TTL-based cleanup (remove if no ingestion for 1 hour).
```

**6. WAV header patching failure (H2)**
```
Location: server/src/services/uploadService.ts:165
Fix: Re-throw error instead of swallowing. Return error to client.
     Client can retry or fall back to simple upload.
```

**7. Silence tracking reset (H3)**
```
Location: web/src/services/metricsService.ts
Fix: Call resetMetrics() inside stopMetrics().
```

**8. Capacity check race (H4)**
```
Location: server/src/socket/session.ts
Fix: Use DynamoDB conditional write or atomic counter for capacity enforcement.
```

### Nice to Have

**9. Upload progress reset on fallback (M2)**
```
Location: web/src/services/uploadService.ts:115-121
Fix: Call onProgress({ loaded: 0, total: blob.size, percent: 0 }) before fallback.
```

**10. AudioWorklet fallback notification (M1)**
```
Location: web/src/services/recorderService.ts
Fix: Log warning and expose a flag so UI can show "using fallback recorder" notice.
```

---

## Data Flow Summary

```
                    ┌─── AudioWorklet ───┐
                    │  Float32 chunks    │
                    │  → memory array    │
                    │  → IndexedDB       │
getUserMedia ───────┤                    ├──► stopRecording()
  (48kHz PCM)       │                    │      → encodeWAV()
                    ├─── AnalyserNode ──►│        → WAV blob
                    │  → RMS, peak       │          → S3 upload
                    │  → spectral        │
                    │  → 5s emit to srv  │
                    │                    │
                    ├─── WebRTC ────────►│  P2P audio (live monitoring only)
                    │  → RTCPeerConn     │
                    │  → remote <audio>  │
                    └────────────────────┘
```

---

## File Reference

| Category | File | Purpose |
|----------|------|---------|
| **Pages** | `web/src/pages/Home.tsx` | Create/join session |
| | `web/src/pages/GreenRoom.tsx` | 3-phase mic validation |
| | `web/src/pages/Studio.tsx` | Recording orchestration |
| | `web/src/pages/Results.tsx` | View recordings & downloads |
| **Hooks** | `web/src/hooks/useSocket.ts` | Socket.IO connection + events |
| | `web/src/hooks/useWebRTC.ts` | RTCPeerConnection lifecycle |
| | `web/src/hooks/useRecorder.ts` | Start/stop/recover recording |
| | `web/src/hooks/useUpload.ts` | Upload progress tracking |
| | `web/src/hooks/useAudioMetrics.ts` | Real-time audio analysis |
| **Services** | `web/src/services/socketService.ts` | Socket.IO singleton |
| | `web/src/services/recorderService.ts` | AudioWorklet + WAV encoding |
| | `web/src/services/uploadService.ts` | Simple & multipart S3 upload |
| | `web/src/services/webrtcService.ts` | PeerConnection factory + ICE |
| | `web/src/services/metricsService.ts` | RMS/peak/clip computation |
| | `web/src/services/spectralService.ts` | FFT spectral analysis |
| **Server Handlers** | `server/src/socket/session.ts` | Join room, participant mgmt |
| | `server/src/socket/signaling.ts` | WebRTC relay |
| | `server/src/socket/recording.ts` | Start/stop recording |
| | `server/src/socket/liveMetrics.ts` | Metrics ingestion + warnings |
| | `server/src/socket/greenRoom.ts` | Mic check evaluation |
| **Server Services** | `server/src/services/metricsService.ts` | Quality aggregation |
| | `server/src/services/uploadService.ts` | S3 ops + WAV patching |
| **Server Routes** | `server/src/routes/upload.ts` | Simple upload endpoints |
| | `server/src/routes/multipartUpload.ts` | Multipart upload endpoints |
| **Repos** | `server/src/repositories/sessionRepo.ts` | DynamoDB session CRUD |
| | `server/src/repositories/meetingRepo.ts` | DynamoDB meeting CRUD |
| | `server/src/repositories/recordingRepo.ts` | DynamoDB recording CRUD |
| | `server/src/repositories/recordingStateRepo.ts` | DynamoDB recording state |
| **Infra** | `server/src/infra/dynamodb.ts` | DynamoDB client config |
| | `server/src/infra/redis.ts` | Redis client for Socket.IO adapter |
| | `server/src/infra/s3.ts` | S3 client + presigned URL generation |
