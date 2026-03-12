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
3. This key is passed as `DAILY_API_KEY` during deployment (see Makefile targets)

## 3. Deploy the AWS Infrastructure

The SAM template (`infrastructure/template.yaml`) provisions all required AWS resources. Deploy it first — the outputs are needed for the next steps.

```bash
# One-time: download static ffmpeg for Lambda
make ffmpeg

# Deploy backend
make deploy-stage DAILY_API_KEY=your-api-key
```

### What gets created

| Resource | Purpose |
|----------|---------|
| **S3 Bucket** (`audio-studio-recordings-{env}-{account-id}`) | Stores raw recordings from Daily and processed audio |
| **IAM Role** (`audio-studio-daily-role-{env}`) | Cross-account role that lets Daily.co write to your S3 bucket |
| **DynamoDB Table** (`audio-studio-sessions-{env}`) | Session state, participant info, pause events |
| **API Gateway** | HTTP API with CORS for the frontend |
| **API Lambda** | FastAPI backend for session management |
| **Audio Merger Lambda** | ffmpeg-based processor for merging/converting audio tracks |
| **CloudFront + S3** | Frontend hosting |

### Note the stack outputs

After deployment, grab these values — you'll need them next:

```bash
aws cloudformation describe-stacks \
  --stack-name audio-studio-{env} \
  --region ap-south-1 \
  --query "Stacks[0].Outputs" \
  --output table
```

Key outputs:
- `DailyRecordingsRoleArn` — needed for step 4
- `RecordingsBucketName` — needed for step 4
- `ApiUrl` — needed for webhook setup (step 5)
- `FrontendUrl` — your CloudFront URL

## 4. Configure Daily.co S3 Storage (Critical)

This tells Daily.co to write recordings to your S3 bucket instead of their default storage. Without this, recordings won't land in your bucket.

### How it works

Daily.co's AWS account (`291871421005`) assumes the IAM role in your account via `sts:AssumeRole`. The role's trust policy uses your Daily domain as the `ExternalId` for security.

### Set S3 bucket via Daily.co API

Replace the placeholder values with your actual stack outputs:

```bash
curl -X POST "https://api.daily.co/v1/" \
  -H "Authorization: Bearer <DAILY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "properties": {
      "recordings_bucket": {
        "bucket_name": "<RecordingsBucketName from stack output>",
        "bucket_region": "ap-south-1",
        "assume_role_arn": "<DailyRecordingsRoleArn from stack output>",
        "allow_api_access": true
      }
    }
  }'
```

This sets it at the **domain level** so all rooms use your bucket. Daily will upload a test file (`daily-co-test-upload.txt`) to verify permissions.

### Verify it worked

```bash
curl "https://api.daily.co/v1/" \
  -H "Authorization: Bearer <DAILY_API_KEY>" | jq '.config.recordings_bucket'
```

You should see your bucket name and role ARN in the response.

## 5. Set Up Webhooks

Webhooks let Daily.co notify your API when recordings finish, participants join/leave, etc. The `recording.ready-to-download` webhook is **required** — it triggers the audio merger Lambda.

1. In the Daily dashboard, go to **Developers → Webhooks**
2. Add a webhook endpoint: `<ApiUrl from stack output>/webhooks/daily`
3. Select these events:
   - `recording.ready-to-download` (required — triggers audio processing)
   - `recording.error`
   - `participant.joined`
   - `participant.left`
4. Copy the **webhook signing secret**
5. Redeploy with the secret:
   ```bash
   make deploy-stage DAILY_API_KEY=your-key DAILY_WEBHOOK_SECRET=your-secret
   ```

## 6. Deploy the Frontend

```bash
make deploy-stage-fe
```

This auto-reads the API URL from CloudFormation outputs, builds the frontend, syncs to S3, and invalidates the CloudFront cache.

## 7. Verify End-to-End

1. Open the frontend in a browser (CloudFront URL from stack outputs)
2. Create a session (enter host & guest names)
3. Copy the guest invite link and open in another browser/tab
4. Join as guest, then start recording from the host view
5. Speak for a few seconds, then end the session
6. Check your S3 bucket — you should see raw audio files under `<your-domain>/session-<id>/`
7. The Audio Merger Lambda triggers automatically via the `recording.ready-to-download` webhook and writes processed files to `processed/session-<id>/`

---

## S3 Key Structure Reference

Daily.co writes raw-tracks recordings with this key pattern:

```
<domain>/session-<sessionId>/<recordingTimestamp>-<connectionId>-cam-audio-<trackTimestamp>
```

### Identifying participants from S3 keys

Each participant's audio track contains their Daily `connectionId` (UUID). To map a track to a participant, look up the `connectionId` in the session's `connection_history` field in DynamoDB:

```json
{
  "connection_history": {
    "<connectionId-A>": "host-<userId>",
    "<connectionId-B>": "guest-<sessionId>"
  },
  "participants": {
    "host-<userId>": "Alice",
    "guest-<sessionId>": "Bob"
  }
}
```

Match the `connectionId` from the S3 key → find the `userId` via `connection_history` → look up the display name in `participants`.

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

### Audio Merger Lambda not processing
- Ensure the `recording.ready-to-download` webhook is configured in Daily dashboard
- Check CloudWatch logs for both the API Lambda and Audio Merger Lambda
- Verify the session status is `processing` in DynamoDB (set by `end_session`)
- You can manually trigger the merger for testing:
  ```bash
  aws lambda invoke \
    --function-name audio-studio-merger-{env} \
    --region ap-south-1 \
    --payload '{"session_id":"<id>","domain":"<domain>"}' \
    --cli-binary-format raw-in-base64-out \
    /dev/stdout
  ```
