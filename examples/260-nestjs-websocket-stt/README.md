# NestJS WebSocket Real-Time Transcription

A NestJS application that exposes a Socket.IO WebSocket gateway for real-time audio transcription, bridging browser microphone input to Deepgram's streaming STT API and returning live transcripts to connected clients.

## What you'll build

A NestJS server with a WebSocket gateway that accepts audio chunks from browser clients, pipes them to Deepgram's live transcription API using the official Node SDK, and streams interim and final transcripts back to each connected client. Includes a minimal browser client for testing.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |

Copy `.env.example` to `.env` and fill in your values.

## Install and run

```bash
npm install
npm run build
npm start
```

Then open `http://localhost:3000` in your browser and click **Start Microphone**.

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's latest and most accurate STT model |
| `smart_format` | `true` | Adds punctuation and formatting automatically |
| `interim_results` | `true` | Returns partial transcripts while the speaker is still talking |
| `utterance_end_ms` | `1000` | Fires a speech-final event after 1 second of silence |
| `encoding` | `linear16` | 16-bit PCM encoding from the browser's AudioContext |
| `sample_rate` | `16000` | 16 kHz sample rate for high-quality speech recognition |

## How it works

1. The browser captures microphone audio via `getUserMedia` and resamples it to 16 kHz 16-bit PCM using an `AudioContext`
2. Audio chunks are sent over Socket.IO to the NestJS `TranscriptionGateway`
3. On each new client connection, the gateway creates a dedicated Deepgram live transcription session via `DeepgramService`
4. The service forwards audio buffers to Deepgram using `connection.sendMedia()`
5. Deepgram returns interim and final transcript events, which the gateway emits back to the specific client
6. When a client disconnects, its Deepgram session is cleanly closed

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
