# Riverside.fm Recording Transcription

Receive Riverside webhook events when a recording completes, download each participant's isolated audio track, transcribe every track with Deepgram pre-recorded STT, and produce a merged speaker-labelled transcript.

## What you'll build

A Node.js Express server that listens for Riverside `recording.completed` webhooks, fetches the per-track audio files (each participant recorded separately at source quality), submits each track to Deepgram STT with diarization disabled (since tracks are already per-speaker), and returns a merged, time-ordered transcript with speaker labels.

## Prerequisites

- Node.js 18 or later
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- Riverside account — [sign up](https://riverside.fm/)

## Environment variables

Copy `.env.example` to `.env` and fill in your keys:

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console → API Keys](https://console.deepgram.com/) |
| `RIVERSIDE_API_KEY` | [Riverside dashboard → Settings → API](https://riverside.fm/dashboard) |

## Install and run

```bash
cp .env.example .env
# Fill in your API keys in .env

npm install
npm start
```

The server starts on port 3000 (override with `PORT` env var).

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check |
| `POST` | `/webhook/riverside` | Receives Riverside webhook events |
| `POST` | `/transcribe` | Manual transcription — accepts `{ tracks: [{ participant_name, download_url }] }` |

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's most accurate speech model |
| `smart_format` | `true` | Adds punctuation, casing, and paragraph formatting |
| `diarize` | `false` | Disabled — Riverside already isolates speakers into separate tracks |
| `tag` | `deepgram-examples` | Tags usage in the Deepgram console for tracking |

## How it works

1. Riverside sends a `recording.completed` webhook with metadata about each participant's audio track
2. The server downloads each track's audio via the Riverside download URL
3. Each track is submitted to Deepgram pre-recorded STT independently (no diarization needed since each track is one speaker)
4. Word-level results from all tracks are merged and sorted chronologically
5. Consecutive words from the same speaker are grouped into segments
6. The final output is a speaker-labelled transcript with timing information

## Example output

```json
{
  "transcript": "[Host] Welcome to the show today.\n[Guest] Thanks for having me!",
  "segments": [
    { "speaker": "Host", "start": 0.0, "end": 1.5, "text": "Welcome to the show today." },
    { "speaker": "Guest", "start": 1.6, "end": 2.8, "text": "Thanks for having me!" }
  ],
  "word_count": 11,
  "track_count": 2,
  "speakers": ["Host", "Guest"]
}
```

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
