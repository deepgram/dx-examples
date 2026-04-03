# Loom Video Transcription with Deepgram

Transcribe Loom video recordings using Deepgram's nova-3 pre-recorded speech-to-text. This example builds a Node.js Express server that accepts a Loom share URL, fetches the video via the Loom Developer API, and returns a full transcript powered by Deepgram.

## What you'll build

A Node.js server that takes a Loom video URL, downloads the recording from Loom's CDN via their Developer API, and sends it to Deepgram pre-recorded STT for a complete transcript with speaker diarization and smart formatting. Useful for teams who use Loom for async communication and want searchable, indexed transcripts.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- Loom Developer account — [access the developer portal](https://www.loom.com/developer-portal)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `LOOM_API_KEY` | [Loom developer portal](https://www.loom.com/developer-portal) → API Keys |

## Install and run

```bash
cp .env.example .env
# Add your API keys to .env

npm install
npm start
```

Then send a Loom video for transcription:

```bash
curl -X POST http://localhost:3000/transcribe \
  -H "Content-Type: application/json" \
  -d '{"url": "https://www.loom.com/share/YOUR_VIDEO_ID"}'
```

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's most accurate general-purpose model |
| `smart_format` | `true` | Adds punctuation, capitalisation, and number formatting |
| `diarize` | `true` | Labels each word with a speaker number for multi-speaker recordings |
| `paragraphs` | `true` | Groups transcript into readable paragraphs |

## How it works

1. Client sends a Loom share URL to `POST /transcribe`
2. Server extracts the video ID from the URL
3. Server calls the Loom Developer API to get video metadata and a time-limited download URL
4. Server downloads the video file from Loom's CDN
5. Server sends the video buffer to Deepgram's pre-recorded STT API (Deepgram accepts video files directly — no audio extraction needed)
6. Server returns the transcript with word count, duration, and speaker labels

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
