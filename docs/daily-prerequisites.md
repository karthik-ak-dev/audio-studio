# Daily.co Prerequisites & Setup

Step-by-step guide to set up Daily.co and AWS for raw-tracks audio recording.

**Important:** Steps must be followed in order — each step depends on outputs from the previous one.

---

## 1. Create a Daily.co Account

1. Sign up at [https://dashboard.daily.co](https://dashboard.daily.co)
2. Note your **domain name** from the dashboard URL — looks like `https://YOUR_DOMAIN.daily.co`
3. This value is referenced as `DAILY_DOMAIN` throughout the platform

## 2. Get Your API Key

1. In the Daily dashboard, go to **Developers → API Keys**
2. Copy your API key — this is passed as `DAILY_API_KEY` during deployment

## 3. Deploy the AWS Infrastructure (without webhook secret)

The SAM template provisions all AWS resources. Deploy it first **without** a webhook secret — the webhook endpoint must be live before Daily.co can register against it.

```bash
# One-time: download static ffmpeg binary for Lambda
make ffmpeg

# Deploy backend (no DAILY_WEBHOOK_SECRET yet — added in step 6)
make deploy-stage DAILY_API_KEY=<your-api-key>
```

### What gets created

| Resource | Purpose |
|----------|---------|
| **S3 Bucket** (`audio-studio-recordings-{env}-{account}`) | Raw recordings from Daily + processed audio |
| **IAM Role** (`audio-studio-daily-role-{env}`) | Cross-account role for Daily.co to write to S3 |
| **DynamoDB Table** (`audio-studio-sessions-{env}`) | Session state, participants, pause events |
| **API Gateway + API Lambda** | FastAPI backend for session management |
| **Audio Merger Lambda** | ffmpeg-based audio processor (triggered by webhook) |
| **CloudFront + S3** | Frontend hosting |

### Get the stack outputs

You'll need these values for the next steps:

```bash
aws cloudformation describe-stacks \
  --stack-name audio-studio-{env} \
  --region ap-south-1 \
  --query "Stacks[0].Outputs" \
  --output table
```

Key outputs needed:

| Output | Used in |
|--------|---------|
| `RecordingsBucketName` | Step 4 (S3 storage config) |
| `DailyRecordingsRoleArn` | Step 4 (S3 storage config) |
| `ApiUrl` | Step 5 (webhook URL) |
| `FrontendUrl` | Your CloudFront URL |

## 4. Configure Daily.co S3 Storage

Tells Daily.co to write recordings directly to your S3 bucket (not their default storage).

### How it works

Daily.co's AWS account (`291871421005`) assumes the IAM role in your account via `sts:AssumeRole`. The role's trust policy requires your Daily domain as `ExternalId` for security.

### Set S3 bucket via Daily.co domain config API

```bash
curl -X POST "https://api.daily.co/v1/" \
  -H "Authorization: Bearer <DAILY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "properties": {
      "recordings_bucket": {
        "bucket_name": "<RecordingsBucketName>",
        "bucket_region": "ap-south-1",
        "assume_role_arn": "<DailyRecordingsRoleArn>",
        "allow_api_access": true
      }
    }
  }'
```

This sets it at the **domain level** — all rooms will use this bucket. Daily uploads a test file (`daily-co-test-upload.txt`) to verify permissions. If the request fails, check the IAM role permissions.

### Verify

```bash
curl "https://api.daily.co/v1/" \
  -H "Authorization: Bearer <DAILY_API_KEY>" | jq '.config.recordings_bucket'
```

You should see your bucket name and role ARN in the response.

## 5. Set Up Webhooks

The `recording.ready-to-download` webhook is **required** — it's the trigger that invokes the audio merger Lambda to process recordings.

### Why deploy before this step

Daily.co sends a test request to your webhook URL when creating it. If the endpoint doesn't return 200, webhook creation fails. That's why step 3 deploys the backend first (without a webhook secret — signature verification is skipped when the secret is empty).

### Create the webhook via Daily.co API

```bash
curl -X POST "https://api.daily.co/v1/webhooks" \
  -H "Authorization: Bearer <DAILY_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "<ApiUrl>/webhooks/daily",
    "eventTypes": [
      "recording.ready-to-download",
      "recording.error",
      "participant.joined",
      "participant.left"
    ]
  }'
```

### Save the HMAC secret from the response

The response includes an `hmac` field — **save this value**. Example response:

```json
{
  "uuid": "...",
  "url": "https://xxx.execute-api.ap-south-1.amazonaws.com/webhooks/daily",
  "hmac": "abc123base64secret==",
  "eventTypes": ["recording.ready-to-download", ...],
  "state": "ACTIVE",
  ...
}
```

### Verify webhooks are registered

```bash
curl "https://api.daily.co/v1/webhooks" \
  -H "Authorization: Bearer <DAILY_API_KEY>"
```

## 6. Redeploy with Webhook Secret

Now redeploy the backend with the HMAC secret to enable signature verification:

```bash
make deploy-stage \
  DAILY_API_KEY=<your-api-key> \
  DAILY_WEBHOOK_SECRET=<hmac-from-step-5>
```

This ensures all incoming webhook requests are verified via HMAC-SHA256 — rejects forged requests.

## 7. Deploy the Frontend

```bash
make deploy-stage-fe
```

Auto-reads API URL from CloudFormation outputs, builds the frontend with `VITE_API_BASE_URL`, syncs to S3, and invalidates CloudFront cache.

## 8. Verify End-to-End

1. Open the CloudFront URL in a browser
2. Create a session (enter host & guest names)
3. Copy the guest invite link → open in another browser/tab
4. Join as guest, then start recording from the host view
5. Speak for a few seconds, then end the session
6. Wait ~30 seconds for Daily.co to upload raw tracks to S3
7. The `recording.ready-to-download` webhook fires → API Lambda invokes Audio Merger Lambda
8. Check S3: raw tracks under `<domain>/session-<id>/`, processed files under `processed/session-<id>/`
9. Session status in DynamoDB should transition: `processing` → `completed`

---

## S3 Key Structure Reference

Daily.co writes raw-tracks recordings with this key pattern:

```
<domain>/session-<sessionId>/<recordingTimestamp>-<connectionId>-cam-audio-<trackTimestamp>
```

### Identifying participants from S3 keys

Each track contains a Daily `connectionId` (UUID). Map it to a participant via the session's `connection_history` in DynamoDB:

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

Flow: S3 key → extract `connectionId` → `connection_history[connectionId]` → `userId` → `participants[userId]` → display name.

---

## Room Configuration Reference

Rooms are created programmatically via the Daily API. Settings are in `api/app/constants.py`:

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

### Webhook creation fails (`non-200 status code returned`)

- Your API Lambda must be deployed and reachable **before** creating the webhook
- If `DAILY_WEBHOOK_SECRET` is set to an invalid value (e.g. a placeholder), signature verification fails and returns 401 to Daily's test request
- **Fix:** Redeploy without a webhook secret first (`make deploy-stage DAILY_API_KEY=...`), then create the webhook, then redeploy with the HMAC

### Recordings not appearing in S3

- Verify S3 bucket config: `curl "https://api.daily.co/v1/" -H "Authorization: Bearer <KEY>" | jq '.config.recordings_bucket'`
- Check that `sts:ExternalId` in the IAM role trust policy matches your Daily domain exactly
- Ensure `bucket_region` matches your actual S3 bucket region

### 403 when starting recording

- The meeting token must have `enable_recording: "raw-tracks"`
- The room must be created with `enable_recording: "raw-tracks"`
- Only room owners (`is_owner: true` in the token) can start recordings

### Audio Merger Lambda returns `no_tracks`

- The merger looks for tracks at `<domain>/session-<id>/` in the recordings bucket
- If Daily.co is still pointing to a different bucket, tracks won't be found
- Verify with: `aws s3 ls s3://<RecordingsBucketName>/<domain>/session-<id>/`

### Audio Merger Lambda not triggering automatically

- Ensure the `recording.ready-to-download` webhook is registered: `curl "https://api.daily.co/v1/webhooks" -H "Authorization: Bearer <KEY>"`
- Check CloudWatch logs for both API Lambda and Audio Merger Lambda
- You can manually trigger the merger for testing:
  ```bash
  aws lambda invoke \
    --function-name audio-studio-merger-{env} \
    --region ap-south-1 \
    --payload '{"session_id":"<id>","domain":"<domain>"}' \
    --cli-binary-format raw-in-base64-out \
    /dev/stdout
  ```

### Session stuck in `processing` status

- The audio merger may have failed — check CloudWatch logs for `audio-studio-merger-{env}`
- If the merger errored, session status will be `error` with an `error_message` field
- If it's still `processing`, the webhook may not have fired — check webhook state via the Daily API
