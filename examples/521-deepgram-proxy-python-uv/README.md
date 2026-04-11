# Deepgram Proxy Server (Python + UV)

A Python FastAPI proxy server that sits between client applications and the Deepgram API, keeping your API key secure on the server side. Uses UV for fast dependency management. This is the Python counterpart to the Node.js proxy server (example 520).

## What you'll build

A FastAPI server that proxies three types of Deepgram requests: pre-recorded transcription (REST), live streaming transcription (WebSocket), and text-to-speech (REST). A minimal browser client demonstrates all three features through the proxy.

## Prerequisites

- Python 3.10+
- [UV](https://docs.astral.sh/uv/) (`pip install uv` or `curl -LsSf https://astral.sh/uv/install.sh | sh`)
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) → Settings → API Keys |

## Install and run

```bash
cp .env.example .env
# Add your DEEPGRAM_API_KEY to .env

uv pip install -r requirements.txt
uv run uvicorn src.server:app --reload --port 3000
# Open http://localhost:3000
```

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/v1/listen` | Pre-recorded transcription — send `{ "url": "..." }` |
| `POST` | `/v1/speak` | Text-to-speech — send `{ "text": "..." }` |
| `WS` | `/v1/listen/stream` | Live STT — stream raw linear16 audio, receive JSON transcripts |
| `GET` | `/health` | Health check |
| `GET` | `/` | Demo client UI |

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Latest general-purpose STT model |
| `smart_format` | `true` | Adds punctuation, capitalisation, number formatting |
| `interim_results` | `true` | Partial transcripts while speaker is still talking |
| `encoding` | `linear16` | Raw PCM format for WebSocket audio |
| `sample_rate` | `16000` | 16 kHz sample rate for WebSocket audio |

## How it works

1. The proxy server starts and reads `DEEPGRAM_API_KEY` from the environment — it never forwards the key to clients
2. **Pre-recorded**: Client POSTs a JSON body with an audio URL to `/v1/listen`. The server calls `client.listen.v1.media.transcribe_url()` and returns the full Deepgram response
3. **Live STT**: Client opens a WebSocket to `/v1/listen/stream`. The server opens a parallel connection to Deepgram via `client.listen.v1.connect()`, bridges audio from client to Deepgram, and relays transcript JSON back
4. **TTS**: Client POSTs text to `/v1/speak`. The server calls `client.speak.v1.audio.generate()` and streams the audio bytes back
5. The API key never leaves the server — clients interact only with the proxy endpoints

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
