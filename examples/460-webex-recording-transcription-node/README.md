# Webex Recording Transcription with Deepgram

Automatically transcribe Cisco Webex meeting recordings using Deepgram's nova-3 speech-to-text model. When a Webex meeting recording becomes available, this server receives a webhook, downloads the audio, transcribes it with Deepgram, and optionally posts the transcript back to a Webex space.

## What you'll build

A Node.js Express server that listens for Webex `meetingRecording.ready` webhooks, downloads the recording audio via the Webex REST API, sends it to Deepgram for transcription with speaker diarization, and logs the formatted transcript.

## Prerequisites

- Node.js 18+
- pnpm
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- Webex account — [create a bot](https://developer.webex.com/my-apps/new/bot)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `WEBEX_BOT_TOKEN` | [Webex Developer Portal → My Apps](https://developer.webex.com/my-apps) — copy the Bot Access Token |
| `WEBEX_WEBHOOK_SECRET` | You choose this value when creating the webhook via the Webex API |

## Install and run

```bash
cp .env.example .env
# Fill in your credentials in .env

pnpm install
pnpm start
```

Then register a Webex webhook pointing to your server:

```bash
curl -X POST https://webexapis.com/v1/webhooks \
  -H "Authorization: Bearer $WEBEX_BOT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Recording Transcription",
    "targetUrl": "https://your-server.example.com/webhook",
    "resource": "meetingRecordings",
    "event": "ready",
    "secret": "your-webhook-secret"
  }'
```

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's most accurate general-purpose model |
| `diarize` | `true` | Enables speaker labels for multi-speaker meetings |
| `smart_format` | `true` | Adds punctuation, capitalization, and number formatting |
| `paragraphs` | `true` | Groups transcript into readable paragraphs |

## How it works

1. A Webex meeting ends and the recording is processed by Webex
2. Webex sends a `meetingRecording.ready` webhook to this server
3. The server verifies the webhook signature (HMAC-SHA1)
4. It fetches the recording metadata from the Webex Recordings API
5. It downloads the audio file using the temporary direct download link
6. The audio buffer is sent to Deepgram's pre-recorded transcription API
7. The transcript is logged, with speaker labels and paragraph formatting
8. Optionally, the transcript is posted back to a Webex space

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
