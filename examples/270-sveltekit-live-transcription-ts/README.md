# SvelteKit Real-Time Live Transcription

A SvelteKit application that captures microphone audio in the browser and streams it to Deepgram's live STT API (Nova-3) via a server-side WebSocket proxy, displaying interim and final transcription results in real time.

## What you'll build

A SvelteKit app where clicking "Start Listening" captures your microphone, streams audio through a server-side WebSocket proxy to Deepgram, and displays live transcription with interim (partial) and final results — all while keeping your API key secure on the server.

## Prerequisites

- Node.js 18+
- A modern browser (Chrome, Firefox, Safari, Edge)
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |

Copy `.env.example` to `.env` and add your key.

## Install and run

```bash
npm install
npm run dev
```

Then open [http://localhost:5173](http://localhost:5173) in your browser and click **Start Listening**.

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's flagship STT model — best accuracy and lowest latency |
| `encoding` | `linear16` | Raw 16-bit PCM, the format produced by the browser ScriptProcessorNode |
| `sample_rate` | `16000` | 16 kHz — good accuracy while keeping bandwidth low |
| `smart_format` | `true` | Adds punctuation, capitalisation, and number formatting |
| `interim_results` | `true` | Returns partial transcripts while you're still speaking |
| `utterance_end_ms` | `1500` | Milliseconds of silence before Deepgram considers an utterance complete |

## How it works

1. The browser requests microphone access via `getUserMedia()`
2. A `ScriptProcessorNode` captures raw PCM float32 samples at 16 kHz and converts them to 16-bit signed integers (linear16)
3. The browser sends each PCM buffer over a WebSocket to the SvelteKit server at `/api/listen`
4. The server opens a Deepgram live transcription session using the official `@deepgram/sdk` and forwards each audio chunk
5. Deepgram returns interim and final transcript events; the server relays them back to the browser over the same WebSocket
6. The Svelte frontend renders final text in black and interim (partial) text in grey, updating reactively in real time
7. The API key never leaves the server — the browser has no access to it

## Architecture

```
Browser (Svelte)          SvelteKit Server          Deepgram
┌──────────────┐         ┌───────────────┐         ┌──────────┐
│ getUserMedia  │──PCM──▶│ /api/listen   │──WSS──▶│ Nova-3   │
│ ScriptProc.   │◀─JSON──│ WS proxy      │◀─JSON──│ Live STT │
└──────────────┘         └───────────────┘         └──────────┘
```

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
