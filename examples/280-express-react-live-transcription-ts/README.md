# Express.js + React Live Transcription (TypeScript)

A full-stack application with an Express.js backend and React frontend that demonstrates real-time live transcription using Deepgram's Nova-3 model. The server proxies WebSocket connections so your API key never leaves the backend.

## What you'll build

A monorepo with an Express.js server and a React (Vite) client. The browser captures microphone audio via `getUserMedia`, streams raw PCM through a WebSocket to the Express server, which proxies it to Deepgram Live STT. Transcripts — including interim results and speaker diarization labels — flow back to the React UI in real time.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |

## Install and run

```bash
# 1. Clone and enter the example directory
cd examples/280-express-react-live-transcription-ts

# 2. Copy env file and add your Deepgram API key
cp .env.example server/.env

# 3. Install dependencies
cd server && npm install && cd ../client && npm install && cd ..

# 4a. Development (two terminals)
cd server && npm run dev      # Express on :3000
cd client && npm run dev      # Vite on :5173 (proxies WS to :3000)

# 4b. Production
cd client && npm run build    # Build React into client/dist
cd ../server && npm run build && npm start  # Serves everything on :3000
```

Open `http://localhost:5173` (dev) or `http://localhost:3000` (prod) and click **Start Listening**.

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Latest general-purpose STT model with best accuracy |
| `encoding` | `linear16` | Raw 16-bit PCM — avoids browser codec overhead |
| `sample_rate` | `16000` | 16 kHz — sufficient for speech, lower bandwidth |
| `interim_results` | `true` | Partial transcripts while still speaking |
| `smart_format` | `true` | Auto punctuation, capitalisation, number formatting |
| `diarize` | `true` | Speaker labels (Speaker 0, Speaker 1, …) |
| `utterance_end_ms` | `1500` | Silence threshold before finalising an utterance |

## How it works

1. The React client requests microphone access via `getUserMedia` (mono, 16 kHz).
2. An `AudioContext` + `ScriptProcessorNode` converts float32 samples to 16-bit PCM.
3. PCM chunks are sent over a WebSocket to the Express server at `/listen`.
4. The server opens a Deepgram Live STT connection and proxies audio chunks via `sendBinary()`.
5. Deepgram returns JSON messages with `channel.alternatives[0].transcript` and `is_final`.
6. The server relays each message back to the browser WebSocket.
7. React state updates show final transcripts (with optional speaker labels) and greyed-out interim text.

```
Browser (React)            Express Server              Deepgram
┌──────────────┐          ┌──────────────┐          ┌──────────────┐
│ getUserMedia  │─ PCM ──▶│ /listen WS   │─ PCM ──▶│ Live STT     │
│              │          │ proxy        │          │ Nova-3       │
│ Transcript UI│◀─ JSON ──│              │◀─ JSON ──│              │
└──────────────┘          └──────────────┘          └──────────────┘
```

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
