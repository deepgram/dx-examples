# Nuxt Streaming STT + TTS with Deepgram

A Nuxt 3 application that captures microphone audio in the browser, streams it to Deepgram for real-time speech-to-text via a Nitro WebSocket server route, and provides text-to-speech playback using Deepgram's TTS REST API. The API key stays server-side — it never reaches the client.

## What you'll build

A full-stack Nuxt 3 app where you speak into your microphone and see live transcripts appear in the browser, with interim (partial) results displayed as you speak and final results appended permanently. You can also type text and hear it spoken back using Deepgram's Aura TTS voices.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |

## Install and run

```bash
cd examples/240-nuxt-streaming-stt-tts-ts
cp .env.example .env
# Add your DEEPGRAM_API_KEY to .env

npm install
npm run dev
# Open http://localhost:3000
```

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's latest and most accurate STT model |
| `encoding` | `linear16` | Raw 16-bit PCM — no codec overhead |
| `sample_rate` | `16000` | 16 kHz for STT input (speech-optimised) |
| `smart_format` | `true` | Auto-punctuation, capitalisation, and number formatting |
| `interim_results` | `true` | Partial transcripts for responsive UI |
| `utterance_end_ms` | `1500` | Silence threshold before Deepgram finalises an utterance |
| `model` (TTS) | `aura-2-thalia-en` | Deepgram Aura 2 voice for TTS output |
| `sample_rate` (TTS) | `24000` | 24 kHz for high-quality TTS audio |

## How it works

1. **Browser** — the Vue page uses `getUserMedia` to capture microphone audio, converts float32 samples to linear16 PCM via a `ScriptProcessorNode`, and sends binary frames over a WebSocket to `/api/listen`
2. **Nitro WebSocket route** (`server/routes/api/listen.ts`) — uses `defineWebSocketHandler` to create a Deepgram live STT connection via the official SDK (`client.listen.v1.connect()`), forwards audio binary frames, and relays transcript JSON back to the browser
3. **Transcript display** — interim results appear greyed out and italicised; final results are appended permanently
4. **TTS endpoint** (`server/routes/api/speak.post.ts`) — accepts `{ text }` POST requests, calls `client.speak.v1.audio.generate()` to get linear16 PCM audio, and returns the raw bytes
5. **TTS playback** — the Vue client decodes the PCM response and plays it via the Web Audio API

## Architecture

```
Browser (Vue)
       |
       | WebSocket (binary PCM audio)
       v
Nitro WebSocket Route (/api/listen)
       |
       | @deepgram/sdk listen.v1.connect()
       v
Deepgram STT API (nova-3)
       |
       | JSON transcript events
       v
Nitro -> Browser (JSON over WebSocket)


Browser (Vue)
       |
       | POST /api/speak { text }
       v
Nitro API Route (/api/speak)
       |
       | @deepgram/sdk speak.v1.audio.generate()
       v
Deepgram TTS API (aura-2)
       |
       | linear16 PCM audio
       v
Nitro -> Browser (binary audio response)
```

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
