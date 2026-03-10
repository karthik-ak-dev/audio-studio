# Audio Recording Platform — Technical Implementation Plan

**Version:** 2.0
**Last Updated:** March 10, 2026
**Status:** Production-Ready Blueprint (Validated via Manual Testing)

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [System Architecture](#2-system-architecture)
3. [Technology Stack](#3-technology-stack)
4. [Monorepo Structure](#4-monorepo-structure)
5. [Daily.co Configuration](#5-dailyco-configuration)
6. [AWS Infrastructure (SAM)](#6-aws-infrastructure-sam)
7. [Backend API — `api/`](#7-backend-api)
8. [Audio Merger — `audio-merger/`](#8-audio-merger)
9. [Frontend — `web/`](#9-frontend)
10. [Shared Types & Constants](#10-shared-types--constants)
11. [DynamoDB Data Model](#11-dynamodb-data-model)
12. [Security & Authentication](#12-security--authentication)
13. [Deployment Guide](#13-deployment-guide)
14. [Monitoring & Observability](#14-monitoring--observability)
15. [Cost Analysis](#15-cost-analysis)
16. [Failure Modes & Recovery](#16-failure-modes--recovery)
17. [API Reference](#17-api-reference)
18. [Appendices](#18-appendices)

---

## 1. Executive Summary

### What We're Building

A serverless platform that enables two remote participants to join an audio-only meeting, record their conversation for up to 1 hour, and produce three output files for ML model training:

- `speaker_1.wav` — Mono audio of participant 1 (48kHz, 16-bit PCM)
- `speaker_2.wav` — Mono audio of participant 2 (48kHz, 16-bit PCM)
- `combined.wav` — Mono mix of both participants (48kHz, 16-bit PCM)

### Key Design Decisions

- **Daily.co** handles all WebRTC infrastructure, audio transport, and server-side recording. Audio is encoded with the Opus codec at Full-band Speech settings (~48kHz). Raw tracks are streamed directly to our S3 bucket in **real-time via S3 multipart upload** during the call — nothing is stored on the client or on Daily's servers.
- **Audio-only enforcement** at multiple levels: room config (`start_video_off`), meeting token permissions (`canSend: ['audio']`), and client-side (`videoSource: false`). No video tracks are ever created, ensuring audio-only billing rates apply.
- **Recording requires both participants present.** The backend listens for Daily webhooks and triggers recording via REST API only when participant count equals 2. Neither participant can start recording independently.
- **Fully serverless** — FastAPI on Lambda (via Mangum), post-processing on Lambda (with ffmpeg layer), DynamoDB for state, S3 for storage. Zero servers to maintain.
- **Monorepo** — Single repository with `api/`, `audio-merger/`, and `web/` directories, each with its own SAM template for independent deployment.

### Scale Target

- 100+ concurrent recording sessions
- Each session up to 1 hour
- Output: WAV files (48kHz, 16-bit, mono) suitable for speech model training

### Validated via Testing (March 10, 2026)

The following was manually validated against Daily.co (domain: `ak-kgen`):

| Capability | Validated |
|---|---|
| Room creation via REST API (audio-only, max 2, private) | ✓ |
| Token generation (host/guest with permissions) | ✓ |
| Audio-only call (no video UI, no camera) | ✓ |
| S3 bucket integration (IAM role, direct upload) | ✓ |
| Raw-tracks audio-only recording | ✓ |
| Separate audio track per participant in S3 | ✓ |
| Files are playable WebM/Opus | ✓ |
| Recording auto-stops on maxDuration | ✓ |

---

## 2. System Architecture

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                                                                      │
│  ┌──────────────────┐                                                │
│  │  React + TS App   │  Hosted on S3 + CloudFront                    │
│  │  (Audio-only UI)  │  Repo: web/                                   │
│  │  daily-js SDK     │                                               │
│  └────────┬──────────┘                                               │
│           │                                                          │
│           │ HTTPS                                                    │
│           ▼                                                          │
│  ┌──────────────────┐    ┌────────────────────────────────────────┐  │
│  │  API Gateway      │    │  Daily.co                              │  │
│  │  (REST API)       │    │                                        │  │
│  └────────┬──────────┘    │  ┌─────────┐    ┌──────────────────┐  │  │
│           │               │  │  WebRTC  │    │  GStreamer        │  │  │
│           ▼               │  │  SFU     │───►│  Media Pipeline   │  │  │
│  ┌──────────────────┐    │  └─────────┘    └────────┬─────────┘  │  │
│  │  Lambda           │    │                          │             │  │
│  │  (Mangum+FastAPI) │◄───│  Webhooks               │ S3 Multipart│  │
│  │  Repo: api/       │    │  (participant.joined,    │ Upload      │  │
│  └────────┬──────────┘    │   recording.stopped)     │ (real-time) │  │
│           │               └──────────────────────────┼────────────┘  │
│           │ boto3                                    │               │
│           ▼                                          ▼               │
│  ┌──────────────────┐    ┌───────────────────────────────────────┐   │
│  │  DynamoDB         │    │  S3 Bucket                             │   │
│  │  Sessions Table   │    │                                        │   │
│  └──────────────────┘    │  {domain}/{room_name}/                 │   │
│                          │    ├─ {ts}-{pid}-cam-audio-{ts}        │   │
│                          │    └─ {ts}-{pid}-cam-audio-{ts}        │   │
│                          │                                        │   │
│                          │  processed/{session_id}/               │   │
│                          │    ├─ speaker_1.wav                    │   │
│                          │    ├─ speaker_2.wav                    │   │
│                          │    └─ combined.wav                     │   │
│                          └───────────────────┬────────────────────┘   │
│                                              │                       │
│                                       S3 Event Notification          │
│                                              │                       │
│                                              ▼                       │
│                          ┌───────────────────────────────────────┐   │
│                          │  Lambda (ffmpeg)                       │   │
│                          │  Repo: audio-merger/                   │   │
│                          └───────────────────────────────────────┘   │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

### Data Flow (Step-by-Step)

```
Step 1: Host creates session
  Frontend → API Gateway → Lambda (FastAPI)
    → Daily REST API: Create room (audio-only, max 2, raw-tracks)
    → Daily REST API: Generate host token (is_owner: true)
    → Daily REST API: Generate guest token
    → DynamoDB: Insert session (status: "created")
    → Return: room_url, host_token, guest_token, session_id

Step 2: Host joins
  Frontend (daily-js) → Daily SFU
  Daily webhook → API Gateway → Lambda (FastAPI)
    → DynamoDB: Update status → "waiting_for_guest"

Step 3: Guest joins (via link shared by host manually)
  Frontend (daily-js) → Daily SFU
  Daily webhook → API Gateway → Lambda (FastAPI)
    → DynamoDB: Update status → "ready"
    → Daily REST API: Start recording (raw-tracks-audio-only)
    → DynamoDB: Update status → "recording"

Step 4: During recording (continuous real-time upload)
  Speaker A mic → Browser → WebRTC/Opus → Daily SFU ─┐
  Speaker B mic → Browser → WebRTC/Opus → Daily SFU ─┤
                                                      ▼
                            GStreamer → S3 multipart upload (continuous)
  
  Files are being written to S3 DURING the call, not after.

Step 5: Host stops recording (or maxDuration auto-stops)
  Frontend calls backend → backend calls Daily stopRecording()
  OR maxDuration (3600s) triggers auto-stop
  OR minIdleTimeOut triggers if all mics silent too long
  Daily webhook (recording.stopped) → Lambda → DynamoDB: status → "processing"

Step 6: Post-processing
  S3 Event → audio-merger Lambda
    → Download both .webm tracks
    → ffmpeg: convert each → mono .wav (48kHz, 16-bit)
    → ffmpeg: merge → combined.wav
    → Upload to processed/{session_id}/
    → DynamoDB: status → "completed"

Step 7: ML pipeline picks up processed WAV files
```

### Audio Signal Chain

```
Participant Microphone
  │
  ▼ Raw PCM (browser captures at device sample rate)
  │
  Browser WebRTC Engine
  │  ├─ Echo cancellation (AEC)
  │  ├─ Noise suppression (NS)
  │  ├─ Automatic gain control (AGC)
  │  └─ Opus encoding (Full-band Speech, ~48kHz, ~40kbps)
  │
  ▼ Opus-encoded RTP packets
  │
  Daily SFU (server-side)
  │  └─ Forwards RTP stream to GStreamer pipeline
  │
  ▼ GStreamer captures raw Opus stream
  │  └─ Packages into WebM container (no .webm extension in filename)
  │  └─ S3 multipart upload (continuous, real-time)
  │
  S3: {domain}/{room}/{ts}-{participant_id}-cam-audio-{ts}
  │
  ▼ ffmpeg decodes Opus → PCM (lossless decode step)
  │  └─ Output: 48kHz, 16-bit, mono WAV
  │
  Final: speaker_N.wav

  Quality note: The ONLY lossy step is the Opus encoding in the browser.
  Opus at Full-band Speech settings is transparent for speech.
```

### How Recording Works (Important)

Recording is **NOT** like a file upload at the end. It's a continuous stream:

1. `startRecording()` → Daily's GStreamer pipeline begins capturing audio packets
2. S3 multipart upload begins **immediately** — chunks written every few seconds
3. Files appear in S3 **while recording is still in progress**
4. Recording stops via one of three triggers:
   - Manual: `stopRecording()` API call
   - Auto: `maxDuration` reached (e.g., 3600 seconds = 1 hour)
   - Idle: `minIdleTimeOut` reached (all participants silent/muted)
5. Final chunk uploaded, file finalized in S3

**The files contain continuous audio from start to stop — including silence.** Daily does not selectively record only speech segments.

---

## 3. Technology Stack

### Frontend (`web/`)

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Framework | React | 18+ | UI framework |
| Language | TypeScript | 5+ | Strict type safety |
| WebRTC SDK | @daily-co/daily-js | latest | Audio calls, recording control |
| Build | Vite | 5+ | Fast builds, HMR |
| Hosting | S3 + CloudFront | — | Static site hosting |

### Backend API (`api/`)

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Framework | FastAPI | 0.115+ | API framework |
| Lambda Adapter | Mangum | 0.18+ | ASGI → Lambda handler |
| HTTP Client | httpx | 0.27+ | Async calls to Daily REST API |
| AWS SDK | boto3 | 1.34+ | DynamoDB operations |
| Validation | Pydantic | 2+ | Request/response models |
| Runtime | Python | 3.12 | Lambda runtime |

### Audio Merger (`audio-merger/`)

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| Runtime | Python | 3.12 | Lambda runtime |
| Media | ffmpeg (Lambda Layer) | 7+ | WebM → WAV conversion |
| AWS SDK | boto3 | 1.34+ | S3 + DynamoDB operations |

### Infrastructure

| Component | Technology | Purpose |
|-----------|-----------|---------|
| IaC | AWS SAM (per service) | CloudFormation-based deployment |
| Compute | AWS Lambda (arm64) | Serverless execution |
| API | API Gateway (HTTP API) | REST endpoint routing |
| Database | DynamoDB (on-demand) | Session state management |
| Storage | S3 (versioned) | Recording storage |
| Notifications | SNS (optional) | Processing completion alerts |

### External Services

| Service | Purpose | Pricing |
|---------|---------|---------|
| Daily.co (WebRTC Infra) | Audio transport, SFU, server-side recording | $0.00099/participant-min (audio), $0.01349/recorded-min |

---

## 4. Monorepo Structure

```
audio-recording-platform/
├── README.md
├── .gitignore
├── .env.example                         # Template for environment variables
│
├── api/                                 # Backend API Lambda
│   ├── template.yaml                    # SAM template for API + DynamoDB
│   ├── samconfig.toml                   # SAM deploy config
│   ├── requirements.txt
│   ├── requirements-dev.txt
│   ├── pyproject.toml
│   ├── app/
│   │   ├── __init__.py
│   │   ├── handler.py                   # Mangum entry point
│   │   ├── main.py                      # FastAPI app
│   │   ├── config.py                    # Settings (env vars)
│   │   ├── constants.py                 # Shared constants (statuses, limits)
│   │   ├── routers/
│   │   │   ├── __init__.py
│   │   │   ├── sessions.py              # POST/GET /sessions
│   │   │   └── webhooks.py              # POST /webhooks/daily
│   │   ├── services/
│   │   │   ├── __init__.py
│   │   │   ├── daily_client.py          # Daily.co REST API client
│   │   │   └── session_store.py         # DynamoDB CRUD operations
│   │   ├── schemas/
│   │   │   ├── __init__.py
│   │   │   ├── requests.py              # Pydantic request models
│   │   │   ├── responses.py             # Pydantic response models
│   │   │   └── webhooks.py              # Daily webhook event models
│   │   └── middleware/
│   │       ├── __init__.py
│   │       └── auth.py                  # API key / auth middleware
│   └── tests/
│       ├── __init__.py
│       ├── conftest.py                  # Shared fixtures
│       ├── test_sessions.py
│       ├── test_webhooks.py
│       └── test_daily_client.py
│
├── audio-merger/                        # Post-processing Lambda
│   ├── template.yaml                    # SAM template for processor + S3 events
│   ├── samconfig.toml
│   ├── requirements.txt
│   ├── processor/
│   │   ├── __init__.py
│   │   ├── handler.py                   # Lambda entry point
│   │   ├── config.py                    # Settings (env vars)
│   │   ├── constants.py                 # Audio format constants
│   │   ├── converter.py                 # ffmpeg WebM → WAV logic
│   │   ├── merger.py                    # ffmpeg track merge logic
│   │   ├── s3_client.py                 # S3 download/upload operations
│   │   └── session_store.py             # DynamoDB status updates
│   ├── layers/
│   │   └── ffmpeg/
│   │       └── build.sh                 # Script to build ffmpeg Lambda layer
│   └── tests/
│       ├── __init__.py
│       ├── test_converter.py
│       └── test_handler.py
│
├── web/                                 # React + TypeScript frontend
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   ├── public/
│   │   └── favicon.ico
│   └── src/
│       ├── main.tsx                     # App entry point
│       ├── App.tsx                      # Router setup
│       ├── vite-env.d.ts
│       ├── api/
│       │   └── client.ts               # HTTP client for backend API
│       ├── hooks/
│       │   ├── useDaily.ts             # Daily.co call management
│       │   ├── useRecordingTimer.ts    # Timer hook
│       │   └── useSessionApi.ts        # Backend API hook
│       ├── pages/
│       │   ├── CreateSession.tsx       # Host creates session
│       │   ├── JoinSession.tsx         # Guest join page
│       │   ├── AudioRoom.tsx           # Main recording interface
│       │   └── SessionComplete.tsx     # Post-recording summary
│       ├── components/
│       │   ├── MicLevelMeter.tsx       # Real-time audio level
│       │   ├── RecordingControls.tsx   # Pause/stop buttons
│       │   ├── ParticipantStatus.tsx   # Who's connected
│       │   ├── Timer.tsx               # Recording duration
│       │   ├── ConnectionStatus.tsx    # Network quality
│       │   └── MuteButton.tsx          # Mic toggle
│       ├── types/
│       │   ├── session.ts              # Session types
│       │   └── daily.ts               # Daily.co event types
│       └── constants/
│           └── index.ts                # Shared UI constants
│
├── infrastructure/                      # Shared infra (S3, IAM for Daily)
│   ├── template.yaml                   # SAM template for S3 bucket + Daily IAM role
│   └── samconfig.toml
│
└── scripts/
    ├── setup-daily-domain.sh           # Configure Daily.co domain settings
    ├── setup-daily-webhooks.sh         # Register webhook endpoints
    ├── create-test-session.sh          # Manual test helper
    └── cleanup-test-rooms.sh           # Delete leftover test rooms
```

### Design Principles

1. **No code duplication** — Shared constants (`SessionStatus`, audio format params) defined once, imported everywhere. DynamoDB table name comes from environment variables, not hardcoded.
2. **Strict typing** — Python uses Pydantic models for all API boundaries. TypeScript uses strict mode with no `any` types in production code.
3. **Independent deployability** — Each service (`api/`, `audio-merger/`, `web/`, `infrastructure/`) has its own SAM template and can be deployed independently.
4. **Environment-aware** — All config via environment variables. `.env.example` documents every required variable.
5. **Testable** — Each service has its own test directory with fixtures.

---

## 5. Daily.co Configuration

### Account Details (Validated)

- **Domain:** `ak-kgen` (URL: `https://ak-kgen.daily.co`)
- **AWS Account ID for IAM trust:** `291871421005` (Daily.co's AWS account)
- **Pricing tier:** WebRTC Infrastructure (audio-only rate: $0.00099/participant-min)
- **S3 file naming pattern (confirmed):**

```
{daily_domain}/{room_name}/{timestamp}-{participant_id}-cam-audio-{timestamp}
```

Example from our test:
```
ak-kgen/test-rec-003/1773140410595-0dda0d32-b91e-4091-a7a1-291319bd65fc-cam-audio-1773140410785
ak-kgen/test-rec-003/1773140410595-16f2bf23-80a9-4a90-8226-657205b5d2e4-cam-audio-1773140454411
```

**Important:** Files do NOT have a `.webm` extension. They are WebM/Opus format but extensionless. The audio-merger must handle this.

### Domain-Level Configuration

Set once via REST API after account setup. These apply to all rooms:

```bash
export DAILY_API_KEY="your-api-key"

curl -X POST "https://api.daily.co/v1" \
  -H "Authorization: Bearer ${DAILY_API_KEY}" \
  -H "Content-Type: application/json" \
  -d '{
    "properties": {
      "enable_recording": "raw-tracks",
      "start_video_off": true,
      "enable_screenshare": false,
      "enable_chat": false,
      "enable_emoji_reactions": false,
      "enable_hand_raising": false,
      "recordings_bucket": {
        "bucket_name": "YOUR_BUCKET_NAME",
        "bucket_region": "ap-south-1",
        "assume_role_arn": "arn:aws:iam::YOUR_ACCOUNT_ID:role/DailyRecordingsRole",
        "allow_api_access": true
      }
    }
  }'
```

### Room Configuration (Per Session)

```python
# api/app/services/daily_client.py — room creation config
ROOM_PROPERTIES = {
    "max_participants": 2,
    "enable_recording": "raw-tracks",
    "start_video_off": True,
    "enable_screenshare": False,
    "enable_chat": False,
    "enable_emoji_reactions": False,
    "eject_at_room_exp": True,
    "sfu_switchover": 0.5,  # Force SFU mode immediately (required for recording)
}
```

### Meeting Token Permissions

```python
# Host: can manage recording, can admin participants
HOST_PERMISSIONS = {
    "hasPresence": True,
    "canSend": ["audio"],           # Audio only — no video
    "canAdmin": ["participants", "transcription"],
}

# Guest: can send audio, no admin
GUEST_PERMISSIONS = {
    "hasPresence": True,
    "canSend": ["audio"],
    "canAdmin": [],
}
```

### Recording Configuration

```python
RECORDING_CONFIG = {
    "type": "raw-tracks",
    "layout": {"preset": "raw-tracks-audio-only"},
    "maxDuration": 3600,        # Auto-stop at 1 hour
    "minIdleTimeOut": 600,      # 10 min idle timeout (increase from default 300)
}
```

### Webhook Events

Register these webhook events with Daily:

```
participant.joined    → Track participant count, auto-start recording when 2 present
participant.left      → Auto-stop recording if participant leaves
recording.started     → Update session status
recording.stopped     → Trigger post-processing
recording.error       → Log and update session status
```

### Mute/Unmute

Both host and guest can independently mute/unmute via `daily-js`:

```typescript
// Mute
call.setLocalAudio(false);

// Unmute
call.setLocalAudio(true);
```

When muted, the recording captures silence for that participant's track. The host can also remotely mute the guest (but guest can unmute themselves):

```typescript
call.updateParticipant(guestSessionId, { setAudio: false });
```

---

## 6. AWS Infrastructure (SAM)

### infrastructure/template.yaml (Shared Resources)

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Description: Audio Recording Platform — Shared Infrastructure (S3, IAM)

Parameters:
  Environment:
    Type: String
    Default: dev
    AllowedValues: [dev, staging, prod]
  DailyDomain:
    Type: String
    Description: "Daily.co domain name (e.g., ak-kgen)"

Resources:

  RecordingsBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub "audio-recordings-${Environment}-${AWS::AccountId}"
      VersioningConfiguration:
        Status: Enabled
      LifecycleConfiguration:
        Rules:
          - Id: DeleteRawAfter30Days
            Prefix: !Sub "${DailyDomain}/"
            Status: Enabled
            ExpirationInDays: 30
          - Id: TransitionProcessedToIA
            Prefix: processed/
            Status: Enabled
            Transitions:
              - StorageClass: STANDARD_IA
                TransitionInDays: 30

  DailyRecordingsRole:
    Type: AWS::IAM::Role
    Properties:
      RoleName: !Sub "DailyRecordingsRole-${Environment}"
      MaxSessionDuration: 43200
      AssumeRolePolicyDocument:
        Version: "2012-10-17"
        Statement:
          - Effect: Allow
            Principal:
              AWS: "arn:aws:iam::291871421005:root"
            Action: "sts:AssumeRole"
            Condition:
              StringEquals:
                sts:ExternalId: !Ref DailyDomain
      Policies:
        - PolicyName: DailyS3WritePolicy
          PolicyDocument:
            Version: "2012-10-17"
            Statement:
              - Effect: Allow
                Action:
                  - "s3:PutObject"
                  - "s3:GetObject"
                  - "s3:DeleteObject"
                  - "s3:ListBucket"
                Resource:
                  - !Sub "arn:aws:s3:::${RecordingsBucket}"
                  - !Sub "arn:aws:s3:::${RecordingsBucket}/*"

Outputs:
  RecordingsBucketName:
    Value: !Ref RecordingsBucket
    Export:
      Name: !Sub "${Environment}-RecordingsBucketName"
  RecordingsBucketArn:
    Value: !GetAtt RecordingsBucket.Arn
    Export:
      Name: !Sub "${Environment}-RecordingsBucketArn"
  DailyRecordingsRoleArn:
    Value: !GetAtt DailyRecordingsRole.Arn
    Description: "Configure this ARN in Daily.co domain recordings_bucket"
```

### api/template.yaml

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Description: Audio Recording Platform — API Service

Parameters:
  Environment:
    Type: String
    Default: dev
  DailyApiKey:
    Type: String
    NoEcho: true
  DailyWebhookSecret:
    Type: String
    NoEcho: true
  DailyDomain:
    Type: String
  RecordingsBucketName:
    Type: String
  FrontendOrigin:
    Type: String
    Default: "http://localhost:5173"

Globals:
  Function:
    Runtime: python3.12
    Timeout: 30
    MemorySize: 512
    Architectures: [arm64]
    Environment:
      Variables:
        ENVIRONMENT: !Ref Environment
        SESSIONS_TABLE: !Ref SessionsTable
        RECORDINGS_BUCKET: !Ref RecordingsBucketName
        DAILY_API_KEY: !Ref DailyApiKey
        DAILY_WEBHOOK_SECRET: !Ref DailyWebhookSecret
        DAILY_DOMAIN: !Ref DailyDomain

Resources:

  HttpApi:
    Type: AWS::Serverless::HttpApi
    Properties:
      StageName: !Ref Environment
      CorsConfiguration:
        AllowOrigins:
          - !Ref FrontendOrigin
        AllowMethods: [GET, POST, PUT, DELETE, OPTIONS]
        AllowHeaders: [Content-Type, Authorization, X-Api-Key]
        MaxAge: 3600

  ApiFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub "audio-api-${Environment}"
      Handler: app.handler.handler
      CodeUri: .
      Events:
        CatchAll:
          Type: HttpApi
          Properties:
            ApiId: !Ref HttpApi
            Path: /{proxy+}
            Method: ANY
      Policies:
        - DynamoDBCrudPolicy:
            TableName: !Ref SessionsTable

  SessionsTable:
    Type: AWS::DynamoDB::Table
    Properties:
      TableName: !Sub "audio-sessions-${Environment}"
      BillingMode: PAY_PER_REQUEST
      AttributeDefinitions:
        - AttributeName: session_id
          AttributeType: S
        - AttributeName: status
          AttributeType: S
        - AttributeName: created_at
          AttributeType: S
        - AttributeName: host_user_id
          AttributeType: S
      KeySchema:
        - AttributeName: session_id
          KeyType: HASH
      GlobalSecondaryIndexes:
        - IndexName: StatusIndex
          KeySchema:
            - AttributeName: status
              KeyType: HASH
            - AttributeName: created_at
              KeyType: RANGE
          Projection:
            ProjectionType: ALL
        - IndexName: HostUserIndex
          KeySchema:
            - AttributeName: host_user_id
              KeyType: HASH
            - AttributeName: created_at
              KeyType: RANGE
          Projection:
            ProjectionType: ALL
      TimeToLiveSpecification:
        AttributeName: ttl
        Enabled: true

Outputs:
  ApiUrl:
    Value: !Sub "https://${HttpApi}.execute-api.${AWS::Region}.amazonaws.com/${Environment}"
  SessionsTableName:
    Value: !Ref SessionsTable
```

### audio-merger/template.yaml

```yaml
AWSTemplateFormatVersion: "2010-09-09"
Transform: AWS::Serverless-2016-10-31
Description: Audio Recording Platform — Audio Merger Service

Parameters:
  Environment:
    Type: String
    Default: dev
  RecordingsBucketName:
    Type: String
  RecordingsBucketArn:
    Type: String
  SessionsTableName:
    Type: String
  DailyDomain:
    Type: String
  FfmpegLayerArn:
    Type: String
    Description: "ARN of the ffmpeg Lambda layer"

Resources:

  ProcessorFunction:
    Type: AWS::Serverless::Function
    Properties:
      FunctionName: !Sub "audio-merger-${Environment}"
      Handler: processor.handler.handler
      CodeUri: .
      Runtime: python3.12
      MemorySize: 1024
      Timeout: 900
      Architectures: [arm64]
      EphemeralStorage:
        Size: 2048
      Layers:
        - !Ref FfmpegLayerArn
      Environment:
        Variables:
          ENVIRONMENT: !Ref Environment
          RECORDINGS_BUCKET: !Ref RecordingsBucketName
          SESSIONS_TABLE: !Ref SessionsTableName
          DAILY_DOMAIN: !Ref DailyDomain
          PROCESSED_PREFIX: "processed/"
      Events:
        S3AudioUpload:
          Type: S3
          Properties:
            Bucket: !Ref RecordingsBucketRef
            Events: s3:ObjectCreated:*
            Filter:
              S3Key:
                Rules:
                  - Name: prefix
                    Value: !Sub "${DailyDomain}/"
                  - Name: suffix
                    Value: "audio"
      Policies:
        - S3CrudPolicy:
            BucketName: !Ref RecordingsBucketName
        - DynamoDBCrudPolicy:
            TableName: !Ref SessionsTableName

  # Reference to existing bucket (not creating a new one)
  RecordingsBucketRef:
    Type: AWS::S3::Bucket
    DeletionPolicy: Retain
    Properties:
      BucketName: !Ref RecordingsBucketName
```

**Note on S3 event trigger:** Since Daily's files end with `cam-audio-{timestamp}` (no `.webm` extension), the S3 event filter uses suffix `audio` to match. The filter prefix uses `{DailyDomain}/` to only process files from our Daily domain.

---

## 7. Backend API

### api/app/constants.py

```python
"""Shared constants — single source of truth for the API service."""

from enum import StrEnum


class SessionStatus(StrEnum):
    CREATED = "created"
    WAITING_FOR_GUEST = "waiting_for_guest"
    RECORDING = "recording"
    PAUSED = "paused"
    STOPPING = "stopping"
    PROCESSING = "processing"
    COMPLETED = "completed"
    ERROR = "error"


# Daily.co room configuration
MAX_PARTICIPANTS: int = 2
ROOM_EXPIRY_BUFFER_SEC: int = 7200       # 2 hours
MAX_SESSION_DURATION_SEC: int = 3600     # 1 hour recording max
MIN_IDLE_TIMEOUT_SEC: int = 600          # 10 min idle before auto-stop
SFU_SWITCHOVER: float = 0.5             # Force SFU immediately

# Audio permissions
AUDIO_ONLY_SEND: list[str] = ["audio"]
HOST_ADMIN_PERMISSIONS: list[str] = ["participants", "transcription"]
GUEST_ADMIN_PERMISSIONS: list[str] = []

# DynamoDB
SESSION_TTL_DAYS: int = 30
SESSION_ID_LENGTH: int = 12
```

### api/app/config.py

```python
"""Application configuration from environment variables."""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    environment: str = "dev"
    sessions_table: str = "audio-sessions-dev"
    recordings_bucket: str = ""
    daily_api_key: str = ""
    daily_webhook_secret: str = ""
    daily_domain: str = ""
    daily_api_base: str = "https://api.daily.co/v1"
    frontend_origin: str = "http://localhost:5173"

    model_config = {"env_file": ".env", "extra": "ignore"}


settings = Settings()
```

### api/app/handler.py

```python
"""Lambda entry point via Mangum."""

from mangum import Mangum
from app.main import app

handler = Mangum(app, lifespan="off")
```

### api/app/main.py

```python
"""FastAPI application setup."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import sessions, webhooks

app = FastAPI(
    title="Audio Recording Platform API",
    version="2.0.0",
    docs_url="/docs" if settings.environment != "prod" else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.frontend_origin],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router, prefix="/sessions", tags=["sessions"])
app.include_router(webhooks.router, prefix="/webhooks", tags=["webhooks"])


@app.get("/health")
async def health() -> dict[str, str]:
    return {"status": "ok", "version": "2.0.0"}
```

### api/app/schemas/requests.py

```python
"""Pydantic request models — strict validation."""

from pydantic import BaseModel, Field


class CreateSessionRequest(BaseModel):
    host_user_id: str = Field(..., min_length=1, max_length=128)
    host_name: str = Field(..., min_length=1, max_length=64)
    guest_name: str = Field(..., min_length=1, max_length=64)
```

### api/app/schemas/responses.py

```python
"""Pydantic response models — strict type definitions."""

from pydantic import BaseModel
from typing import Optional


class CreateSessionResponse(BaseModel):
    session_id: str
    room_url: str
    host_token: str
    guest_token: str
    guest_join_url: str


class SessionResponse(BaseModel):
    session_id: str
    status: str
    host_user_id: str
    host_name: str
    guest_name: str
    participant_count: int
    recording_segments: int
    recording_started_at: Optional[str] = None
    recording_stopped_at: Optional[str] = None
    s3_processed_prefix: Optional[str] = None
    error_message: Optional[str] = None
    created_at: str
    updated_at: str


class SessionActionResponse(BaseModel):
    session_id: str
    status: str


class SessionListResponse(BaseModel):
    sessions: list[SessionResponse]
```

### api/app/schemas/webhooks.py

```python
"""Pydantic models for Daily.co webhook events."""

from pydantic import BaseModel
from typing import Optional, Any


class WebhookPayload(BaseModel):
    room: Optional[str] = None
    participant_id: Optional[str] = None
    user_name: Optional[str] = None
    user_id: Optional[str] = None
    start_ts: Optional[float] = None
    timestamp: Optional[str] = None
    error: Optional[str] = None
    recording_id: Optional[str] = None


class DailyWebhookEvent(BaseModel):
    type: str
    payload: WebhookPayload
    event_ts: Optional[float] = None
    version: Optional[str] = None
```

### api/app/services/daily_client.py

```python
"""Daily.co REST API client — all Daily interactions go through here."""

import time
import logging
from typing import Optional

import httpx

from app.config import settings
from app.constants import (
    MAX_PARTICIPANTS,
    ROOM_EXPIRY_BUFFER_SEC,
    MAX_SESSION_DURATION_SEC,
    MIN_IDLE_TIMEOUT_SEC,
    SFU_SWITCHOVER,
    AUDIO_ONLY_SEND,
    HOST_ADMIN_PERMISSIONS,
    GUEST_ADMIN_PERMISSIONS,
)

logger = logging.getLogger(__name__)


class DailyClient:
    """Async client for Daily.co REST API."""

    def __init__(self) -> None:
        self.base_url = settings.daily_api_base
        self.headers = {
            "Authorization": f"Bearer {settings.daily_api_key}",
            "Content-Type": "application/json",
        }

    async def create_room(self, session_id: str) -> dict:
        """Create an audio-only, 2-person private room."""
        room_name = f"session-{session_id}"
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/rooms",
                headers=self.headers,
                json={
                    "name": room_name,
                    "privacy": "private",
                    "properties": {
                        "max_participants": MAX_PARTICIPANTS,
                        "enable_recording": "raw-tracks",
                        "start_video_off": True,
                        "enable_screenshare": False,
                        "enable_chat": False,
                        "enable_emoji_reactions": False,
                        "eject_at_room_exp": True,
                        "exp": int(time.time()) + ROOM_EXPIRY_BUFFER_SEC,
                        "sfu_switchover": SFU_SWITCHOVER,
                    },
                },
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            logger.info(f"Room created: {room_name}")
            return data

    async def create_token(
        self,
        room_name: str,
        user_id: str,
        user_name: str,
        is_owner: bool,
    ) -> str:
        """Generate a meeting token with audio-only permissions."""
        permissions = {
            "hasPresence": True,
            "canSend": AUDIO_ONLY_SEND,
            "canAdmin": HOST_ADMIN_PERMISSIONS if is_owner else GUEST_ADMIN_PERMISSIONS,
        }

        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/meeting-tokens",
                headers=self.headers,
                json={
                    "properties": {
                        "room_name": room_name,
                        "is_owner": is_owner,
                        "user_name": user_name,
                        "user_id": user_id,
                        "exp": int(time.time()) + ROOM_EXPIRY_BUFFER_SEC,
                        "eject_at_token_exp": True,
                        "enable_recording": "raw-tracks",
                        "permissions": permissions,
                    }
                },
                timeout=10.0,
            )
            response.raise_for_status()
            token: str = response.json()["token"]
            logger.info(f"Token created for {user_name} (owner={is_owner})")
            return token

    async def start_recording(self, room_name: str) -> dict:
        """Start raw-tracks audio-only recording."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/rooms/{room_name}/recordings/start",
                headers=self.headers,
                json={
                    "type": "raw-tracks",
                    "layout": {"preset": "raw-tracks-audio-only"},
                    "maxDuration": MAX_SESSION_DURATION_SEC,
                    "minIdleTimeOut": MIN_IDLE_TIMEOUT_SEC,
                },
                timeout=10.0,
            )
            response.raise_for_status()
            data = response.json()
            logger.info(f"Recording started for room: {room_name}, id: {data.get('recordingId')}")
            return data

    async def stop_recording(self, room_name: str) -> Optional[dict]:
        """Stop the current recording. Returns None if no active recording."""
        async with httpx.AsyncClient() as client:
            response = await client.post(
                f"{self.base_url}/rooms/{room_name}/recordings/stop",
                headers=self.headers,
                timeout=10.0,
            )
            if response.status_code == 400:
                logger.warning(f"No active recording to stop for room: {room_name}")
                return None
            response.raise_for_status()
            logger.info(f"Recording stopped for room: {room_name}")
            return response.json()

    async def delete_room(self, room_name: str) -> None:
        """Delete a room. Silently ignores 404 (already deleted)."""
        async with httpx.AsyncClient() as client:
            response = await client.delete(
                f"{self.base_url}/rooms/{room_name}",
                headers=self.headers,
                timeout=10.0,
            )
            if response.status_code == 404:
                logger.info(f"Room already deleted: {room_name}")
                return
            response.raise_for_status()
            logger.info(f"Room deleted: {room_name}")

    async def get_recording(self, recording_id: str) -> dict:
        """Get recording metadata including S3 keys and track info."""
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{self.base_url}/recordings/{recording_id}",
                headers=self.headers,
                timeout=10.0,
            )
            response.raise_for_status()
            return response.json()


# Singleton instance
daily_client = DailyClient()
```

### api/app/services/session_store.py

```python
"""DynamoDB operations for session management."""

import time
import uuid
import logging
from datetime import datetime, timezone
from typing import Optional
from decimal import Decimal

import boto3

from app.config import settings
from app.constants import SessionStatus, SESSION_TTL_DAYS, SESSION_ID_LENGTH

logger = logging.getLogger(__name__)

dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(settings.sessions_table)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def generate_session_id() -> str:
    return uuid.uuid4().hex[:SESSION_ID_LENGTH]


def create_session(
    session_id: str,
    host_user_id: str,
    host_name: str,
    guest_name: str,
    daily_room_name: str,
    daily_room_url: str,
) -> dict:
    now = _now_iso()
    item = {
        "session_id": session_id,
        "host_user_id": host_user_id,
        "host_name": host_name,
        "guest_name": guest_name,
        "daily_room_name": daily_room_name,
        "daily_room_url": daily_room_url,
        "status": SessionStatus.CREATED,
        "participant_count": 0,
        "recording_segments": 0,
        "created_at": now,
        "updated_at": now,
        "ttl": int(time.time()) + (86400 * SESSION_TTL_DAYS),
    }
    table.put_item(Item=item)
    logger.info(f"Session created: {session_id}")
    return item


def get_session(session_id: str) -> Optional[dict]:
    response = table.get_item(Key={"session_id": session_id})
    item = response.get("Item")
    if item:
        # Convert Decimal to int for JSON serialization
        if "participant_count" in item:
            item["participant_count"] = int(item["participant_count"])
        if "recording_segments" in item:
            item["recording_segments"] = int(item["recording_segments"])
    return item


def update_status(session_id: str, status: SessionStatus, **extra_fields: str) -> None:
    update_expr = "SET #status = :status, updated_at = :now"
    expr_values: dict = {
        ":status": status.value,
        ":now": _now_iso(),
    }
    expr_names = {"#status": "status"}

    for key, value in extra_fields.items():
        safe_key = key.replace("-", "_")
        update_expr += f", {safe_key} = :{safe_key}"
        expr_values[f":{safe_key}"] = value

    table.update_item(
        Key={"session_id": session_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=expr_names,
        ExpressionAttributeValues=expr_values,
    )
    logger.info(f"Session {session_id} status → {status.value}")


def increment_participant_count(session_id: str, delta: int) -> int:
    response = table.update_item(
        Key={"session_id": session_id},
        UpdateExpression="SET participant_count = participant_count + :delta, updated_at = :now",
        ExpressionAttributeValues={
            ":delta": delta,
            ":now": _now_iso(),
        },
        ReturnValues="UPDATED_NEW",
    )
    count = int(response["Attributes"]["participant_count"])
    logger.info(f"Session {session_id} participant_count → {count}")
    return count


def get_sessions_by_host(host_user_id: str, limit: int = 20) -> list[dict]:
    response = table.query(
        IndexName="HostUserIndex",
        KeyConditionExpression="host_user_id = :uid",
        ExpressionAttributeValues={":uid": host_user_id},
        ScanIndexForward=False,
        Limit=limit,
    )
    return response.get("Items", [])
```

### api/app/routers/sessions.py

```python
"""Session management endpoints."""

import logging

from fastapi import APIRouter, HTTPException

from app.constants import SessionStatus
from app.schemas.requests import CreateSessionRequest
from app.schemas.responses import (
    CreateSessionResponse,
    SessionActionResponse,
    SessionListResponse,
)
from app.services.daily_client import daily_client
from app.services import session_store

logger = logging.getLogger(__name__)
router = APIRouter()


@router.post("/", response_model=CreateSessionResponse, status_code=201)
async def create_session(req: CreateSessionRequest) -> CreateSessionResponse:
    """Create a new recording session with Daily room and tokens."""
    session_id = session_store.generate_session_id()

    room = await daily_client.create_room(session_id)
    room_name: str = room["name"]
    room_url: str = room["url"]

    host_token = await daily_client.create_token(
        room_name=room_name,
        user_id=req.host_user_id,
        user_name=req.host_name,
        is_owner=True,
    )
    guest_token = await daily_client.create_token(
        room_name=room_name,
        user_id=f"guest-{session_id}",
        user_name=req.guest_name,
        is_owner=False,
    )

    session_store.create_session(
        session_id=session_id,
        host_user_id=req.host_user_id,
        host_name=req.host_name,
        guest_name=req.guest_name,
        daily_room_name=room_name,
        daily_room_url=room_url,
    )

    return CreateSessionResponse(
        session_id=session_id,
        room_url=room_url,
        host_token=host_token,
        guest_token=guest_token,
        guest_join_url=f"{room_url}?t={guest_token}",
    )


@router.get("/{session_id}")
async def get_session(session_id: str) -> dict:
    """Get session status and metadata."""
    session = session_store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    session.pop("ttl", None)
    return session


@router.post("/{session_id}/stop", response_model=SessionActionResponse)
async def stop_session(session_id: str) -> SessionActionResponse:
    """Stop recording and end the session."""
    session = session_store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session["status"] not in (SessionStatus.RECORDING, SessionStatus.PAUSED):
        raise HTTPException(
            status_code=400,
            detail=f"Cannot stop session in '{session['status']}' status",
        )

    await daily_client.stop_recording(session["daily_room_name"])
    session_store.update_status(session_id, SessionStatus.STOPPING)
    return SessionActionResponse(session_id=session_id, status=SessionStatus.STOPPING)


@router.post("/{session_id}/pause", response_model=SessionActionResponse)
async def pause_session(session_id: str) -> SessionActionResponse:
    """Pause recording (stop + restart creates new segment on resume)."""
    session = session_store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session["status"] != SessionStatus.RECORDING:
        raise HTTPException(status_code=400, detail="Session is not recording")

    await daily_client.stop_recording(session["daily_room_name"])
    session_store.update_status(session_id, SessionStatus.PAUSED)
    return SessionActionResponse(session_id=session_id, status=SessionStatus.PAUSED)


@router.post("/{session_id}/resume", response_model=SessionActionResponse)
async def resume_session(session_id: str) -> SessionActionResponse:
    """Resume a paused recording (starts new recording segment)."""
    session = session_store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    if session["status"] != SessionStatus.PAUSED:
        raise HTTPException(status_code=400, detail="Session is not paused")

    await daily_client.start_recording(session["daily_room_name"])
    new_count = int(session.get("recording_segments", 0)) + 1
    session_store.update_status(
        session_id, SessionStatus.RECORDING, recording_segments=str(new_count)
    )
    return SessionActionResponse(session_id=session_id, status=SessionStatus.RECORDING)


@router.get("/user/{host_user_id}")
async def list_user_sessions(host_user_id: str, limit: int = 20) -> dict:
    """List sessions for a host user."""
    sessions = session_store.get_sessions_by_host(host_user_id, limit=limit)
    return {"sessions": sessions}
```

### api/app/routers/webhooks.py

```python
"""Daily.co webhook handler — processes participant and recording events."""

import hashlib
import hmac
import logging

from fastapi import APIRouter, Request, HTTPException

from app.config import settings
from app.constants import SessionStatus
from app.schemas.webhooks import DailyWebhookEvent
from app.services.daily_client import daily_client
from app.services import session_store

logger = logging.getLogger(__name__)
router = APIRouter()


def _verify_signature(payload: bytes, signature: str) -> bool:
    """Verify Daily.co webhook HMAC-SHA256 signature."""
    if not settings.daily_webhook_secret:
        return True  # Skip in dev when no secret configured
    expected = hmac.new(
        settings.daily_webhook_secret.encode(),
        payload,
        hashlib.sha256,
    ).hexdigest()
    return hmac.compare_digest(expected, signature)


def _extract_session_id(room_name: str) -> str:
    """Extract session_id from room name format: session-{session_id}"""
    prefix = "session-"
    if room_name.startswith(prefix):
        return room_name[len(prefix):]
    return room_name


@router.post("/daily")
async def daily_webhook(request: Request) -> dict[str, str]:
    """Handle all Daily.co webhook events."""
    body = await request.body()
    signature = request.headers.get("x-webhook-signature", "")

    if not _verify_signature(body, signature):
        raise HTTPException(status_code=401, detail="Invalid signature")

    raw = await request.json()
    event_type = raw.get("type", "")
    payload = raw.get("payload", {})
    room_name = payload.get("room", "")
    session_id = _extract_session_id(room_name)

    logger.info(f"Webhook: {event_type} | room={room_name} | session={session_id}")

    if event_type == "participant.joined":
        await _on_participant_joined(session_id, room_name)
    elif event_type == "participant.left":
        await _on_participant_left(session_id, room_name)
    elif event_type == "recording.started":
        _on_recording_started(session_id, payload)
    elif event_type == "recording.stopped":
        _on_recording_stopped(session_id, payload)
    elif event_type == "recording.error":
        _on_recording_error(session_id, payload)

    return {"status": "ok"}


async def _on_participant_joined(session_id: str, room_name: str) -> None:
    session = session_store.get_session(session_id)
    if not session:
        logger.warning(f"Session not found: {session_id}")
        return

    count = session_store.increment_participant_count(session_id, 1)

    if count == 2 and session["status"] in (
        SessionStatus.CREATED,
        SessionStatus.WAITING_FOR_GUEST,
    ):
        logger.info(f"Both participants present — starting recording: {session_id}")
        try:
            result = await daily_client.start_recording(room_name)
            session_store.update_status(
                session_id,
                SessionStatus.RECORDING,
                recording_id=result.get("recordingId", ""),
            )
        except Exception as e:
            logger.error(f"Failed to start recording: {session_id} — {e}")
            session_store.update_status(
                session_id, SessionStatus.ERROR, error_message=str(e)
            )
    elif count == 1:
        session_store.update_status(session_id, SessionStatus.WAITING_FOR_GUEST)


async def _on_participant_left(session_id: str, room_name: str) -> None:
    session = session_store.get_session(session_id)
    if not session:
        return

    count = session_store.increment_participant_count(session_id, -1)

    if count < 2 and session["status"] == SessionStatus.RECORDING:
        logger.info(f"Participant left during recording — stopping: {session_id}")
        await daily_client.stop_recording(room_name)
        session_store.update_status(session_id, SessionStatus.STOPPING)

    if count <= 0:
        session_store.update_status(session_id, SessionStatus.PROCESSING)
        await daily_client.delete_room(room_name)


def _on_recording_started(session_id: str, payload: dict) -> None:
    session_store.update_status(
        session_id,
        SessionStatus.RECORDING,
        recording_started_at=str(payload.get("start_ts", "")),
    )


def _on_recording_stopped(session_id: str, payload: dict) -> None:
    session_store.update_status(
        session_id,
        SessionStatus.PROCESSING,
        recording_stopped_at=str(payload.get("timestamp", "")),
    )


def _on_recording_error(session_id: str, payload: dict) -> None:
    error_msg = payload.get("error", "Unknown recording error")
    logger.error(f"Recording error: {session_id} — {error_msg}")
    session_store.update_status(
        session_id, SessionStatus.ERROR, error_message=error_msg
    )
```

### api/app/middleware/auth.py

```python
"""API authentication middleware."""

from fastapi import Header, HTTPException

from app.config import settings


async def verify_api_key(x_api_key: str = Header(alias="X-Api-Key")) -> str:
    """Verify API key from request header. Use as FastAPI dependency."""
    if not settings.api_key:
        return "dev"  # Skip auth in dev
    if x_api_key != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return x_api_key
```

### api/requirements.txt

```
fastapi==0.115.6
mangum==0.18.0
httpx==0.27.2
pydantic==2.10.0
pydantic-settings==2.7.0
boto3==1.35.0
```

### api/requirements-dev.txt

```
-r requirements.txt
uvicorn==0.34.0
pytest==8.3.0
pytest-asyncio==0.24.0
httpx==0.27.2
moto[dynamodb]==5.0.0
```

---

## 8. Audio Merger

### audio-merger/processor/constants.py

```python
"""Audio processing constants — single source of truth."""

# Output format for ML training
SAMPLE_RATE: int = 48000
BIT_DEPTH: int = 16
CHANNELS: int = 1  # Mono
CODEC: str = "pcm_s16le"

# ffmpeg binary location in Lambda Layer
FFMPEG_PATH: str = "/opt/bin/ffmpeg"

# Processing
FFMPEG_TIMEOUT_SEC: int = 600
EXPECTED_TRACKS_PER_SESSION: int = 2

# Daily.co file naming
AUDIO_TRACK_IDENTIFIER: str = "cam-audio"
```

### audio-merger/processor/config.py

```python
"""Processor configuration from environment variables."""

import os


class ProcessorConfig:
    RECORDINGS_BUCKET: str = os.environ.get("RECORDINGS_BUCKET", "")
    SESSIONS_TABLE: str = os.environ.get("SESSIONS_TABLE", "")
    DAILY_DOMAIN: str = os.environ.get("DAILY_DOMAIN", "")
    PROCESSED_PREFIX: str = os.environ.get("PROCESSED_PREFIX", "processed/")
    ENVIRONMENT: str = os.environ.get("ENVIRONMENT", "dev")


config = ProcessorConfig()
```

### audio-merger/processor/s3_client.py

```python
"""S3 operations for downloading raw tracks and uploading processed WAVs."""

import logging
from typing import Optional

import boto3

from processor.config import config
from processor.constants import AUDIO_TRACK_IDENTIFIER

logger = logging.getLogger(__name__)
s3 = boto3.client("s3")


def list_audio_tracks(room_prefix: str) -> list[str]:
    """List all audio track files for a recording session."""
    response = s3.list_objects_v2(
        Bucket=config.RECORDINGS_BUCKET,
        Prefix=room_prefix,
    )
    contents = response.get("Contents", [])
    tracks = [
        obj["Key"]
        for obj in contents
        if AUDIO_TRACK_IDENTIFIER in obj["Key"]
    ]
    logger.info(f"Found {len(tracks)} audio tracks under {room_prefix}")
    return sorted(tracks)


def download_track(s3_key: str, local_path: str) -> None:
    """Download a single track from S3 to local filesystem."""
    s3.download_file(config.RECORDINGS_BUCKET, s3_key, local_path)
    logger.info(f"Downloaded s3://{config.RECORDINGS_BUCKET}/{s3_key} → {local_path}")


def upload_file(local_path: str, s3_key: str) -> None:
    """Upload a processed file to S3."""
    s3.upload_file(local_path, config.RECORDINGS_BUCKET, s3_key)
    logger.info(f"Uploaded {local_path} → s3://{config.RECORDINGS_BUCKET}/{s3_key}")


def processed_exists(session_id: str) -> bool:
    """Check if this session has already been processed."""
    key = f"{config.PROCESSED_PREFIX}{session_id}/combined.wav"
    response = s3.list_objects_v2(
        Bucket=config.RECORDINGS_BUCKET,
        Prefix=key,
        MaxKeys=1,
    )
    return bool(response.get("Contents"))
```

### audio-merger/processor/converter.py

```python
"""ffmpeg-based audio conversion: WebM/Opus → WAV."""

import subprocess
import logging

from processor.constants import (
    FFMPEG_PATH,
    SAMPLE_RATE,
    CHANNELS,
    CODEC,
    FFMPEG_TIMEOUT_SEC,
)

logger = logging.getLogger(__name__)


def webm_to_wav(input_path: str, output_path: str) -> None:
    """Convert a WebM/Opus file to mono WAV (48kHz, 16-bit PCM)."""
    cmd = [
        FFMPEG_PATH,
        "-y",
        "-i", input_path,
        "-vn",
        "-acodec", CODEC,
        "-ar", str(SAMPLE_RATE),
        "-ac", str(CHANNELS),
        output_path,
    ]
    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=FFMPEG_TIMEOUT_SEC,
    )
    if result.returncode != 0:
        logger.error(f"ffmpeg conversion failed: {result.stderr}")
        raise RuntimeError(f"ffmpeg conversion failed: {result.stderr[:500]}")
    logger.info(f"Converted {input_path} → {output_path}")
```

### audio-merger/processor/merger.py

```python
"""ffmpeg-based audio track merging."""

import subprocess
import logging

from processor.constants import FFMPEG_PATH, SAMPLE_RATE, FFMPEG_TIMEOUT_SEC

logger = logging.getLogger(__name__)


def merge_tracks(wav_paths: list[str], output_path: str) -> None:
    """Merge multiple mono WAV files into a single mono mix."""
    if len(wav_paths) < 2:
        # Single track — just copy
        cmd = [FFMPEG_PATH, "-y", "-i", wav_paths[0], "-c", "copy", output_path]
    else:
        cmd = [
            FFMPEG_PATH,
            "-y",
            "-i", wav_paths[0],
            "-i", wav_paths[1],
            "-filter_complex",
            f"amix=inputs=2:duration=longest:normalize=0,"
            f"aformat=sample_fmts=s16:sample_rates={SAMPLE_RATE}:channel_layouts=mono",
            output_path,
        ]

    result = subprocess.run(
        cmd,
        capture_output=True,
        text=True,
        timeout=FFMPEG_TIMEOUT_SEC,
    )
    if result.returncode != 0:
        logger.error(f"ffmpeg merge failed: {result.stderr}")
        raise RuntimeError(f"ffmpeg merge failed: {result.stderr[:500]}")
    logger.info(f"Merged {len(wav_paths)} tracks → {output_path}")
```

### audio-merger/processor/session_store.py

```python
"""Minimal DynamoDB client for the processor — only updates status."""

import logging
from datetime import datetime, timezone

import boto3

from processor.config import config

logger = logging.getLogger(__name__)
dynamodb = boto3.resource("dynamodb")
table = dynamodb.Table(config.SESSIONS_TABLE)


def update_status(session_id: str, status: str, **extra: str) -> None:
    """Update session status in DynamoDB."""
    update_expr = "SET #status = :status, updated_at = :now"
    values: dict = {
        ":status": status,
        ":now": datetime.now(timezone.utc).isoformat(),
    }
    names = {"#status": "status"}

    for key, value in extra.items():
        update_expr += f", {key} = :{key}"
        values[f":{key}"] = value

    table.update_item(
        Key={"session_id": session_id},
        UpdateExpression=update_expr,
        ExpressionAttributeNames=names,
        ExpressionAttributeValues=values,
    )
    logger.info(f"Session {session_id} → {status}")
```

### audio-merger/processor/handler.py

```python
"""Lambda entry point — triggered by S3 events when Daily uploads audio tracks."""

import os
import logging

from processor.config import config
from processor.constants import AUDIO_TRACK_IDENTIFIER, EXPECTED_TRACKS_PER_SESSION
from processor.s3_client import list_audio_tracks, download_track, upload_file, processed_exists
from processor.converter import webm_to_wav
from processor.merger import merge_tracks
from processor.session_store import update_status

logger = logging.getLogger()
logger.setLevel(logging.INFO)


def handler(event: dict, context: object) -> dict:
    """
    S3 event handler. Triggered when Daily uploads an audio track.
    Waits for both tracks, then converts and merges.
    """
    for record in event.get("Records", []):
        s3_key: str = record["s3"]["object"]["key"]
        logger.info(f"S3 event: {s3_key}")

        # Parse the S3 key: {domain}/{room_name}/{timestamp}-{pid}-cam-audio-{ts}
        parts = s3_key.split("/")
        if len(parts) < 3 or AUDIO_TRACK_IDENTIFIER not in s3_key:
            logger.warning(f"Skipping non-audio key: {s3_key}")
            continue

        domain = parts[0]
        room_name = parts[1]

        # Extract session_id from room_name (format: session-{session_id})
        session_id = room_name.replace("session-", "") if room_name.startswith("session-") else room_name

        # Check if already processed
        if processed_exists(session_id):
            logger.info(f"Session {session_id} already processed, skipping")
            continue

        # List all audio tracks for this room
        room_prefix = f"{domain}/{room_name}/"
        tracks = list_audio_tracks(room_prefix)

        if len(tracks) < EXPECTED_TRACKS_PER_SESSION:
            logger.info(
                f"Session {session_id}: {len(tracks)}/{EXPECTED_TRACKS_PER_SESSION} tracks — waiting"
            )
            continue

        # Process the session
        logger.info(f"Session {session_id}: all tracks present — processing")
        _process_session(session_id, tracks[:EXPECTED_TRACKS_PER_SESSION])

    return {"status": "ok"}


def _process_session(session_id: str, track_keys: list[str]) -> None:
    """Download tracks, convert to WAV, merge, upload results."""
    try:
        # Download raw tracks
        local_tracks: list[str] = []
        for i, s3_key in enumerate(track_keys):
            local_path = f"/tmp/track_{i}.webm"
            download_track(s3_key, local_path)
            local_tracks.append(local_path)

        # Convert each to mono WAV
        wav_files: list[str] = []
        for i, track_path in enumerate(local_tracks):
            wav_path = f"/tmp/speaker_{i + 1}.wav"
            webm_to_wav(track_path, wav_path)
            wav_files.append(wav_path)

        # Merge into combined
        combined_path = "/tmp/combined.wav"
        merge_tracks(wav_files, combined_path)

        # Upload results
        output_prefix = f"{config.PROCESSED_PREFIX}{session_id}"
        for wav_path in wav_files:
            filename = os.path.basename(wav_path)
            upload_file(wav_path, f"{output_prefix}/{filename}")
        upload_file(combined_path, f"{output_prefix}/combined.wav")

        # Update session status
        update_status(
            session_id,
            "completed",
            s3_processed_prefix=f"s3://{config.RECORDINGS_BUCKET}/{output_prefix}/",
        )

        logger.info(f"Session {session_id}: processing complete")

    except Exception as e:
        logger.error(f"Session {session_id}: processing failed — {e}")
        update_status(session_id, "error", error_message=str(e)[:500])
        raise

    finally:
        # Cleanup /tmp
        for path in [*local_tracks, *wav_files, "/tmp/combined.wav"]:
            try:
                os.remove(path)
            except OSError:
                pass
```

### audio-merger/layers/ffmpeg/build.sh

```bash
#!/bin/bash
# Build ffmpeg Lambda layer for arm64
set -euo pipefail

LAYER_DIR="$(dirname "$0")/output"
rm -rf "$LAYER_DIR"
mkdir -p "$LAYER_DIR/bin"

echo "Building ffmpeg layer for arm64..."

docker run --rm --platform linux/arm64 \
  -v "$LAYER_DIR:/output" \
  amazonlinux:2023 bash -c "
    yum install -y tar xz &&
    curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-arm64-static.tar.xz | tar xJ &&
    cp ffmpeg-*-arm64-static/ffmpeg /output/bin/ &&
    chmod +x /output/bin/ffmpeg
  "

echo "Packaging layer..."
cd "$LAYER_DIR"
zip -r ../ffmpeg-layer.zip bin/

echo "Publishing layer..."
LAYER_ARN=$(aws lambda publish-layer-version \
  --layer-name ffmpeg \
  --zip-file "fileb://$(dirname "$0")/ffmpeg-layer.zip" \
  --compatible-runtimes python3.12 \
  --compatible-architectures arm64 \
  --query LayerVersionArn \
  --output text)

echo "Layer published: $LAYER_ARN"
echo "$LAYER_ARN" > "$(dirname "$0")/layer-arn.txt"
```

### audio-merger/requirements.txt

```
boto3==1.35.0
```

---

## 9. Frontend

### web/src/types/session.ts

```typescript
/** Session types — matches backend response models exactly. */

export type SessionStatus =
  | "created"
  | "waiting_for_guest"
  | "recording"
  | "paused"
  | "stopping"
  | "processing"
  | "completed"
  | "error";

export interface CreateSessionRequest {
  host_user_id: string;
  host_name: string;
  guest_name: string;
}

export interface CreateSessionResponse {
  session_id: string;
  room_url: string;
  host_token: string;
  guest_token: string;
  guest_join_url: string;
}

export interface Session {
  session_id: string;
  status: SessionStatus;
  host_user_id: string;
  host_name: string;
  guest_name: string;
  participant_count: number;
  recording_segments: number;
  recording_started_at: string | null;
  recording_stopped_at: string | null;
  s3_processed_prefix: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionActionResponse {
  session_id: string;
  status: SessionStatus;
}
```

### web/src/types/daily.ts

```typescript
/** Daily.co related types for the useDaily hook. */

export interface DailyParticipant {
  session_id: string;
  user_name: string;
  local: boolean;
  audio: boolean;
  owner: boolean;
}

export type NetworkQuality = "good" | "warning" | "bad" | "unknown";

export interface UseDailyState {
  isJoined: boolean;
  isMuted: boolean;
  isRecording: boolean;
  participantCount: number;
  networkQuality: NetworkQuality;
  micLevel: number;
}
```

### web/src/constants/index.ts

```typescript
/** Shared frontend constants. */

export const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8000";

export const MAX_RECORDING_DURATION_SEC = 3600;

export const RECORDING_STATES = {
  IDLE: "idle",
  RECORDING: "recording",
  PAUSED: "paused",
  STOPPED: "stopped",
} as const;
```

### web/src/api/client.ts

```typescript
/** HTTP client for backend API. */

import { API_BASE_URL } from "../constants";
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  Session,
  SessionActionResponse,
} from "../types/session";

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      ...options,
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.detail ?? `API error: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  async createSession(
    data: CreateSessionRequest
  ): Promise<CreateSessionResponse> {
    return this.request<CreateSessionResponse>("/sessions/", {
      method: "POST",
      body: JSON.stringify(data),
    });
  }

  async getSession(sessionId: string): Promise<Session> {
    return this.request<Session>(`/sessions/${sessionId}`);
  }

  async stopSession(sessionId: string): Promise<SessionActionResponse> {
    return this.request<SessionActionResponse>(
      `/sessions/${sessionId}/stop`,
      { method: "POST" }
    );
  }

  async pauseSession(sessionId: string): Promise<SessionActionResponse> {
    return this.request<SessionActionResponse>(
      `/sessions/${sessionId}/pause`,
      { method: "POST" }
    );
  }

  async resumeSession(sessionId: string): Promise<SessionActionResponse> {
    return this.request<SessionActionResponse>(
      `/sessions/${sessionId}/resume`,
      { method: "POST" }
    );
  }
}

export const apiClient = new ApiClient(API_BASE_URL);
```

### web/src/hooks/useDaily.ts

```typescript
/** Core hook for managing Daily.co audio calls. */

import { useState, useEffect, useCallback, useRef } from "react";
import DailyIframe, { DailyCall } from "@daily-co/daily-js";
import type { NetworkQuality } from "../types/daily";

interface UseDailyOptions {
  roomUrl: string;
  token: string;
  onParticipantCountChange?: (count: number) => void;
  onRecordingStarted?: () => void;
  onRecordingStopped?: () => void;
  onError?: (error: string) => void;
}

interface UseDailyReturn {
  callObject: DailyCall | null;
  isJoined: boolean;
  isMuted: boolean;
  isRecording: boolean;
  participantCount: number;
  networkQuality: NetworkQuality;
  join: () => Promise<void>;
  leave: () => Promise<void>;
  toggleMute: () => void;
}

export function useDaily(options: UseDailyOptions): UseDailyReturn {
  const [callObject, setCallObject] = useState<DailyCall | null>(null);
  const [isJoined, setIsJoined] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [participantCount, setParticipantCount] = useState(0);
  const [networkQuality, setNetworkQuality] = useState<NetworkQuality>("good");
  const optionsRef = useRef(options);
  optionsRef.current = options;

  useEffect(() => {
    const call = DailyIframe.createCallObject({
      audioSource: true,
      videoSource: false,
      dailyConfig: {
        experimentalChromeVideoMuteLightOff: true,
      },
    });
    setCallObject(call);
    return () => { call.destroy(); };
  }, []);

  useEffect(() => {
    if (!callObject) return;

    const updateParticipantCount = () => {
      const count = Object.keys(callObject.participants()).length;
      setParticipantCount(count);
      optionsRef.current.onParticipantCountChange?.(count);
    };

    const handlers = {
      "joined-meeting": () => { setIsJoined(true); updateParticipantCount(); },
      "left-meeting": () => { setIsJoined(false); setIsRecording(false); setParticipantCount(0); },
      "participant-joined": updateParticipantCount,
      "participant-left": updateParticipantCount,
      "recording-started": () => { setIsRecording(true); optionsRef.current.onRecordingStarted?.(); },
      "recording-stopped": () => { setIsRecording(false); optionsRef.current.onRecordingStopped?.(); },
      "network-quality-change": (e: { threshold: string }) => {
        setNetworkQuality(e.threshold as NetworkQuality);
      },
      "error": (e: { errorMsg?: string }) => {
        optionsRef.current.onError?.(e.errorMsg ?? "Unknown error");
      },
    };

    for (const [event, handler] of Object.entries(handlers)) {
      callObject.on(event as keyof typeof handlers, handler as () => void);
    }

    return () => {
      for (const [event, handler] of Object.entries(handlers)) {
        callObject.off(event as keyof typeof handlers, handler as () => void);
      }
    };
  }, [callObject]);

  const join = useCallback(async () => {
    if (!callObject) return;
    await callObject.join({
      url: optionsRef.current.roomUrl,
      token: optionsRef.current.token,
    });
  }, [callObject]);

  const leave = useCallback(async () => {
    if (!callObject) return;
    await callObject.leave();
  }, [callObject]);

  const toggleMute = useCallback(() => {
    if (!callObject) return;
    const newMuted = !isMuted;
    callObject.setLocalAudio(!newMuted);
    setIsMuted(newMuted);
  }, [callObject, isMuted]);

  return {
    callObject,
    isJoined,
    isMuted,
    isRecording,
    participantCount,
    networkQuality,
    join,
    leave,
    toggleMute,
  };
}
```

### web/src/hooks/useRecordingTimer.ts

```typescript
/** Timer hook for tracking recording duration. */

import { useState, useEffect, useRef } from "react";
import { MAX_RECORDING_DURATION_SEC } from "../constants";

interface UseRecordingTimerReturn {
  elapsedSeconds: number;
  remainingSeconds: number;
  formattedElapsed: string;
  formattedRemaining: string;
  isWarning: boolean;
}

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = Math.floor(totalSeconds % 60);
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function useRecordingTimer(isRecording: boolean): UseRecordingTimerReturn {
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    if (isRecording) {
      intervalRef.current = window.setInterval(() => {
        setElapsedSeconds((prev) => prev + 1);
      }, 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [isRecording]);

  const remainingSeconds = Math.max(0, MAX_RECORDING_DURATION_SEC - elapsedSeconds);

  return {
    elapsedSeconds,
    remainingSeconds,
    formattedElapsed: formatTime(elapsedSeconds),
    formattedRemaining: formatTime(remainingSeconds),
    isWarning: remainingSeconds < 300, // Warning under 5 minutes
  };
}
```

### web/package.json

```json
{
  "name": "audio-recording-web",
  "private": true,
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "lint": "eslint src/ --ext .ts,.tsx",
    "typecheck": "tsc --noEmit"
  },
  "dependencies": {
    "react": "^18.3.0",
    "react-dom": "^18.3.0",
    "react-router-dom": "^6.28.0",
    "@daily-co/daily-js": "^0.74.0"
  },
  "devDependencies": {
    "typescript": "^5.7.0",
    "vite": "^6.0.0",
    "@types/react": "^18.3.0",
    "@types/react-dom": "^18.3.0",
    "@vitejs/plugin-react": "^4.3.0",
    "@typescript-eslint/eslint-plugin": "^8.0.0",
    "@typescript-eslint/parser": "^8.0.0"
  }
}
```

### web/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "useDefineForClassFields": true,
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "isolatedModules": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": ["src"]
}
```

---

## 10. Shared Types & Constants

To avoid duplication across services, constants are defined independently in each service but must stay in sync. The canonical definitions are:

| Constant | api/ location | audio-merger/ location | web/ location |
|---|---|---|---|
| Session statuses | `app/constants.py` | Uses string literals | `types/session.ts` |
| Audio format (48kHz, 16-bit, mono) | N/A | `processor/constants.py` | N/A |
| Max duration (3600s) | `app/constants.py` | N/A | `constants/index.ts` |
| Daily domain | Environment variable | Environment variable | N/A (server-side only) |
| S3 bucket name | Environment variable | Environment variable | N/A |

**Convention:** If a constant changes, update all three locations. Consider a shared JSON config file in the repo root as a future improvement.

---

## 11. DynamoDB Data Model

### Sessions Table

```
Table Name: audio-sessions-{environment}
Billing: PAY_PER_REQUEST (on-demand)
TTL: Enabled on "ttl" attribute (auto-delete after 30 days)

Primary Key:
  Partition Key: session_id (String) — UUID hex truncated to 12 chars

Attributes:
  session_id            String    PK
  host_user_id          String    Who created the session
  host_name             String    Display name of host
  guest_name            String    Display name of guest
  daily_room_name       String    format: session-{session_id}
  daily_room_url        String    https://ak-kgen.daily.co/session-{session_id}
  status                String    SessionStatus enum value
  participant_count     Number    Current in-room count (0, 1, or 2)
  recording_segments    Number    Incremented on pause/resume
  recording_id          String    Daily recording UUID (from startRecording response)
  recording_started_at  String    ISO8601 timestamp
  recording_stopped_at  String    ISO8601 timestamp
  s3_processed_prefix   String    s3://bucket/processed/{session_id}/
  error_message         String    Error details if status is "error"
  created_at            String    ISO8601 creation timestamp
  updated_at            String    ISO8601 last update timestamp
  ttl                   Number    Unix epoch for DynamoDB auto-deletion

GSI: StatusIndex
  PK: status, SK: created_at
  Use: Find sessions by status (e.g., stuck in "processing")

GSI: HostUserIndex
  PK: host_user_id, SK: created_at
  Use: List a user's sessions in reverse chronological order
```

### Status Lifecycle

```
  created → waiting_for_guest → recording → stopping → processing → completed
                                  │    ▲
                                  ▼    │
                                paused─┘
  
  Any state → error (on failure)
```

| Status | Trigger |
|---|---|
| `created` | POST /sessions — room created, tokens generated |
| `waiting_for_guest` | Webhook: first participant joins |
| `recording` | Webhook: second participant joins → auto-start recording |
| `paused` | POST /sessions/:id/pause |
| `stopping` | POST /sessions/:id/stop or participant leaves |
| `processing` | Webhook: recording.stopped → files in S3, awaiting conversion |
| `completed` | audio-merger Lambda finishes → WAV files ready |
| `error` | Any failure (recording error, processing error) |

---

## 12. Security & Authentication

### API Authentication

MVP: API key in `X-Api-Key` header. Production: integrate with existing auth (Cognito, Auth0, etc.).

### Webhook Security

Daily.co webhooks verified via HMAC-SHA256. The `x-webhook-signature` header is validated against the shared secret. Never process webhooks without verification in production.

### Daily.co Token Security

Tokens are JWTs signed by Daily. Not encrypted — never embed sensitive data. Always set `room_name` and `exp`. Generate server-side only.

### S3 Security

Private bucket. Only Daily's AWS account (291871421005) can write via IAM role with external ID verification. Lambda functions access via execution roles.

### Network

All HTTPS/TLS. WebRTC media encrypted via DTLS-SRTP. S3 uploads via TLS.

---

## 13. Deployment Guide

### Prerequisites

- AWS CLI + SAM CLI configured
- Node.js 18+ (frontend)
- Python 3.12 (backend)
- Docker (ffmpeg layer build)
- Daily.co account with card on file

### Deploy Order

```bash
# 1. Shared infrastructure (S3 bucket, IAM role)
cd infrastructure/
sam build && sam deploy

# 2. Configure Daily domain with S3 bucket (one-time)
source ../scripts/setup-daily-domain.sh

# 3. Build and publish ffmpeg layer
cd ../audio-merger/layers/ffmpeg/
bash build.sh

# 4. Deploy API
cd ../../api/
sam build && sam deploy

# 5. Configure Daily webhooks (needs API Gateway URL from step 4)
source ../scripts/setup-daily-webhooks.sh

# 6. Deploy audio-merger
cd ../audio-merger/
sam build && sam deploy

# 7. Build and deploy frontend
cd ../web/
npm install && npm run build
aws s3 sync dist/ s3://your-frontend-bucket/ --delete
```

### Environment Variables (.env.example)

```bash
# Daily.co
DAILY_API_KEY=your_daily_api_key
DAILY_WEBHOOK_SECRET=your_webhook_hmac_secret
DAILY_DOMAIN=ak-kgen

# AWS
ENVIRONMENT=dev
SESSIONS_TABLE=audio-sessions-dev
RECORDINGS_BUCKET=audio-recordings-dev-ACCOUNT_ID

# Frontend
VITE_API_BASE_URL=https://your-api-gateway-url/dev
```

---

## 14. Monitoring & Observability

### CloudWatch Alerts

| Metric | Threshold |
|---|---|
| API Lambda errors | > 5/min |
| API Lambda p99 latency | > 10s |
| audio-merger Lambda errors | > 3/min |
| audio-merger Lambda duration | > 600s |
| DynamoDB throttled requests | > 0 |
| Sessions stuck in "processing" | > 30 min |

### Daily.co Dashboard

Monitor at https://dashboard.daily.co: call quality, participant stats, recording status, API usage/billing.

---

## 15. Cost Analysis

### Per 1-Hour Session

| Component | Cost |
|---|---|
| Daily audio calling (2 × 60 min × $0.00099) | $0.12 |
| Daily recording (60 min × $0.01349) | $0.81 |
| AWS Lambda + S3 + DynamoDB | ~$0.02 |
| **Total** | **~$0.95** |

### Monthly Projections

| Sessions/Month | Total |
|---|---|
| 50 | ~$48 |
| 100 | ~$96 |
| 500 | ~$480 |
| 1,000 | ~$960 |

First 10,000 participant-minutes/month free (~83 sessions). $15 one-time recording credit.

---

## 16. Failure Modes & Recovery

| Failure | What Happens | Recovery |
|---|---|---|
| Participant disconnects | Recording continues for remaining speaker | Webhook stops recording, files safe in S3 |
| Browser crash | Recording safe server-side | WebRTC timeout → participant.left webhook |
| audio-merger timeout | 15-min Lambda timeout, 2GB /tmp | CloudWatch alarm on stuck "processing" sessions |
| Daily outage | Room/recording API errors | Frontend retry, sessions in "error" queryable |
| S3 event missed | Lambda not triggered | Scheduled Lambda re-processes stuck sessions |
| Webhook failure | Daily retries with backoff | Handler is idempotent |

---

## 17. API Reference

| Method | Path | Description |
|---|---|---|
| POST | /sessions/ | Create session (room + tokens) |
| GET | /sessions/{id} | Get session status |
| POST | /sessions/{id}/stop | Stop recording |
| POST | /sessions/{id}/pause | Pause recording |
| POST | /sessions/{id}/resume | Resume recording |
| GET | /sessions/user/{user_id} | List user's sessions |
| POST | /webhooks/daily | Daily.co webhook receiver |
| GET | /health | Health check |

See Section 7 (routers/sessions.py) for full request/response schemas.

---

## 18. Appendices

### A. Local Development

```bash
# Backend
cd api && python -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000

# Frontend
cd web && npm install && npm run dev

# Webhooks (use ngrok)
ngrok http 8000
```

### B. Daily.co S3 File Naming (Confirmed via Testing)

```
{daily_domain}/{room_name}/{timestamp}-{participant_id}-cam-audio-{timestamp}

Example:
ak-kgen/test-rec-003/1773140410595-0dda0d32-b91e-4091-a7a1-291319bd65fc-cam-audio-1773140410785
ak-kgen/test-rec-003/1773140410595-16f2bf23-80a9-4a90-8226-657205b5d2e4-cam-audio-1773140454411

Note: NO .webm extension. Files are WebM/Opus format but extensionless.
```

### C. Recording API Response (Confirmed via Testing)

```json
{
  "id": "6a320ec7-5150-4502-b4b7-053b2a57e5d1",
  "room_name": "test-rec-003",
  "start_ts": 1773140410,
  "status": "in-progress",
  "max_participants": 2,
  "tracks": [
    {
      "size": 378507,
      "type": "audio",
      "s3Key": "ak-kgen/test-rec-003/1773140410595-...-cam-audio-..."
    },
    {
      "size": 52018,
      "type": "audio",
      "s3Key": "ak-kgen/test-rec-003/1773140410595-...-cam-audio-..."
    }
  ]
}
```

### D. Scaling (100+ Concurrent Sessions)

- 200 WebRTC connections → handled by Daily.co
- ~200 webhook events/hour → Lambda handles easily
- 100 concurrent audio-merger Lambdas → within default 1000 concurrency limit
- ~74 GB WAV files per 100 sessions → S3 handles unlimited

For 1000+ sessions: add SQS between S3 events and audio-merger, consider ECS Fargate for processing, use DynamoDB auto-scaling.