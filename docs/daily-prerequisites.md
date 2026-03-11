# Daily.co Prerequisites & Setup

Step-by-step guide to set up Daily.co and AWS for raw-tracks audio recording. Follow this before your first deployment.

---

## 1. Create a Daily.co Account

1. Sign up at [https://dashboard.daily.co](https://dashboard.daily.co)
2. Once signed in, note your **domain name** from the dashboard URL — it looks like `https://YOUR_DOMAIN.daily.co`
3. This value is referenced as `DAILY_DOMAIN` throughout the platform

## 2. Get Your API Key

1. In the Daily dashboard, go to **Developers → API Keys**
2. Copy your API key
3. Create a `.env` file in the project root (use `.env.example` as reference):
   ```
   DAILY_API_KEY=your-api-key-here
   ```
4. This key is used by the backend to create rooms, generate meeting tokens, and control recordings

## 3. Deploy the AWS Infrastructure

The SAM template (`infrastructure/template.yaml`) provisions all required AWS resources. Deploy it first — the outputs are needed for the next steps.

```bash
cd infrastructure
sam build
sam deploy --guided
```

You'll be prompted for these parameters:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `Environment` | `dev`, `stage`, or `prod` | `dev` |
| `DailyApiKey` | API key from step 2 | (hidden input) |
| `DailyWebhookSecret` | Webhook secret (step 5, can leave empty initially) | (hidden input) |
| `DailyDomain` | Your Daily.co domain name | `my-domain` |
| `FrontendOrigin` | CORS origin for your frontend | `http://localhost:5173` |
| `MergeDuration` | Audio merge strategy | `longest` |

### What gets created

| Resource | Purpose |
|----------|---------|
| **S3 Bucket** (`audio-recordings-{env}-{account-id}`) | Stores raw recordings from Daily and processed audio |
| **IAM Role** (`DailyRecordingsRole-{env}`) | Cross-account role that lets Daily.co write to your S3 bucket |
| **DynamoDB Table** (`audio-sessions-{env}`) | Session state, participant info, pause events |
| **API Gateway** | HTTP API with CORS for the frontend |
| **API Lambda** | FastAPI backend for session management |
| **Audio Merger Lambda** | ffmpeg-based processor triggered by S3 uploads |
| **ffmpeg Layer** | Static ffmpeg binary for arm64 Lambda |

### Note the stack outputs

After deployment, grab these values — you'll need them next:

```bash
# Get all outputs at once
aws cloudformation describe-stacks \
  --stack-name audio-recording-platform-{env} \
  --query "Stacks[0].Outputs" \
  --output table
```

Key outputs:
- `DailyRecordingsRoleArn` — needed for step 4
- `RecordingsBucketName` — needed for step 4
- `ApiUrl` — needed for frontend config

## 4. Configure Daily.co S3 Storage (Critical)

This tells Daily.co to write recordings to your S3 bucket instead of their default storage. Without this, recordings won't land in your bucket.

### How it works

Daily.co's AWS account (`291871421005`) assumes the IAM role in your account via `sts:AssumeRole`. The role's trust policy uses your Daily domain as the `ExternalId` for security.

### Set S3 bucket via Daily.co API

Replace the placeholder values with your actual stack outputs:

```bash
curl -X POST "https://api.daily.co/v1/recordings/s3-bucket" \
  -H "Authorization: Bearer <DAILY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "assume_role_arn": "<DailyRecordingsRoleArn from stack output>",
    "bucket_name": "<RecordingsBucketName from stack output>",
    "bucket_region": "<your-aws-region>",
    "allow_api_access": true
  }'
```

### Verify it worked

```bash
curl "https://api.daily.co/v1/recordings/s3-bucket" \
  -H "Authorization: Bearer <DAILY_API_KEY>"
```

You should see your bucket name and role ARN in the response.

## 5. Set Up Webhooks (Optional but Recommended)

Webhooks let Daily.co notify your API when recordings finish, participants join/leave, etc.

1. In the Daily dashboard, go to **Developers → Webhooks**
2. Add a webhook endpoint: `<ApiUrl from stack output>/webhooks/daily`
3. Select relevant events (e.g. `recording.started`, `recording.stopped`, `participant.joined`, `participant.left`)
4. Copy the **webhook signing secret**
5. Update your SAM deployment with the secret:
   ```bash
   sam deploy --parameter-overrides \
     DailyApiKey=<your-key> \
     DailyWebhookSecret=<your-webhook-secret> \
     DailyDomain=<your-domain> \
     FrontendOrigin=<your-frontend-url>
   ```

## 6. Deploy the Frontend

Build the web app with the API Gateway URL:

```bash
cd web
VITE_API_BASE_URL=<ApiUrl from stack output> npm run build
```

Deploy the `dist/` folder to your hosting provider (S3 + CloudFront, Vercel, Netlify, etc.).

## 7. Verify End-to-End

1. Open the frontend in a browser
2. Create a session (enter host & guest names)
3. Copy the guest invite link and open in another browser/tab
4. Join as guest, then start recording from the host view
5. Speak for a few seconds, then end the session
6. Check your S3 bucket — you should see raw audio files under `<your-domain>/session-<id>/`
7. The Audio Merger Lambda should trigger automatically and write processed files to `processed/`

---

## S3 Key Structure Reference

Daily.co writes raw-tracks recordings with this key pattern:

```
<domain>/session-<sessionId>/<recordingTimestamp>-<connectionId>-cam-audio-<trackTimestamp>
```

### Identifying participants from S3 keys

Each participant's audio track contains their Daily `connectionId`. To map a track to a participant, look up the `connectionId` in the session's `participant_connections` field in DynamoDB:

```json
{
  "participant_connections": {
    "host-<userId>": "<connectionId-A>",
    "guest-<sessionId>": "<connectionId-B>"
  },
  "participants": {
    "host-<userId>": "Alice",
    "guest-<sessionId>": "Bob"
  }
}
```

Match the `connectionId` from the S3 key → find the `userId` → look up the display name in `participants`.

---

## Room Configuration Reference

Rooms are created programmatically via the Daily API. These settings are defined in `api/app/constants.py`:

| Setting | Value | Notes |
|---------|-------|-------|
| `privacy` | `private` | Token required to join |
| `max_participants` | `2` | Host + guest only |
| `enable_recording` | `raw-tracks` | Separate audio track per participant |
| `start_video_off` | `true` | Audio-only platform |
| `enable_screenshare` | `false` | Audio-only |
| `enable_chat` | `false` | Not needed |
| `sfu_switchover` | `0.5` | Always use SFU mode |
| `room expiry` | `7200s` | 2 hour buffer |
| `max recording duration` | `3600s` | 1 hour max |
| `idle timeout` | `600s` | 10 min idle before auto-stop |

---

## Troubleshooting

### Recordings not appearing in S3
- Verify the IAM role ARN is correctly set in Daily.co (`GET /v1/recordings/s3-bucket`)
- Check that the `sts:ExternalId` in the role trust policy matches your Daily domain exactly
- Ensure the `bucket_region` in the Daily config matches your actual S3 bucket region
- Check CloudWatch logs for the API Lambda for any errors during recording start

### 403 when starting recording
- The meeting token must have `enable_recording: "raw-tracks"`
- The room must be created with `enable_recording: "raw-tracks"`
- Only room owners (`is_owner: true` in the token) can start recordings

### Recording files are empty or missing tracks
- Both participants must be connected and unmuted when recording starts
- Verify the `raw-tracks-audio-only` layout preset is used in the start recording call
- Check the Daily dashboard → Recordings tab for per-recording status and error details

### Audio Merger Lambda not triggering
- Confirm the S3 event notification is set up (SAM template handles this)
- The trigger filters on prefix `<domain>/` and suffix `audio` — verify your recordings match
- Check CloudWatch logs for the Audio Merger Lambda
