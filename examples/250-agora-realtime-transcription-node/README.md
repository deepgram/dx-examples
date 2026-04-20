# Agora Real-Time Audio Transcription

Transcribe live audio from an Agora RTC channel in real-time using Deepgram's streaming speech-to-text API. Participants join a voice/video channel and see live captions as they speak, with speaker diarization to identify who said what.

## What you'll build

A Node.js server that generates Agora RTC tokens, serves a browser-based UI where users join an Agora channel, captures microphone audio from the Agora session, streams it to Deepgram for real-time transcription, and displays live captions with speaker labels.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- Agora account — [sign up](https://console.agora.io/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `AGORA_APP_ID` | [Agora console](https://console.agora.io/) → Project Management → App ID |
| `AGORA_APP_CERTIFICATE` | [Agora console](https://console.agora.io/) → Project Management → App Certificate (enable if not active) |

Copy `.env.example` to `.env` and fill in your values.

## Install and run

```bash
npm install
cp .env.example .env
# Fill in your API keys in .env
npm start
```

Open `http://localhost:3000` in your browser, enter a channel name, and click "Join Channel". Speak into your microphone and watch transcripts appear in real-time.

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's most accurate general-purpose STT model |
| `encoding` | `linear16` | 16-bit signed PCM — captured from the browser's AudioContext |
| `sample_rate` | `16000` | 16 kHz sample rate for high-quality speech recognition |
| `diarize` | `true` | Enables speaker labels to distinguish channel participants |
| `interim_results` | `true` | Shows partial transcripts while the speaker is still talking |

## How it works

1. The browser requests an Agora RTC token from `POST /api/token` — the server generates it using the App Certificate (never exposed to the client)
2. The browser joins the Agora channel using the Agora Web SDK, publishes its microphone audio, and subscribes to remote participants
3. An AudioContext captures the local microphone track, converts float32 samples to signed 16-bit PCM at 16 kHz, and sends binary frames over a WebSocket to `/transcribe`
4. The Node.js server receives audio frames and forwards them to a Deepgram live STT connection
5. Deepgram returns interim and final transcript events with speaker labels, which the server relays back to the browser
6. The browser displays live captions overlaid on the video area and appends final transcripts to a scrolling log panel

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
