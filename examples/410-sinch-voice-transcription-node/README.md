# Sinch Voice API — Real-Time Call Transcription

Transcribe live phone calls in real-time by connecting the Sinch Voice API's ConnectStream WebSocket to Deepgram's streaming speech-to-text API. Every word spoken on a call is transcribed within milliseconds and printed to the console.

## What you'll build

A Node.js Express server that receives inbound Sinch phone calls, responds with SVAML to route the call audio over a WebSocket, and forwards the raw PCM audio to Deepgram for live transcription.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- Sinch account with Voice capability — [sign up](https://dashboard.sinch.com/)
- A Sinch Voice application with a linked phone number
- A public URL for your server (use [ngrok](https://ngrok.com/) for local development)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `SINCH_APPLICATION_KEY` | [Sinch dashboard](https://dashboard.sinch.com/voice/apps) → your Voice app |
| `SINCH_APPLICATION_SECRET` | [Sinch dashboard](https://dashboard.sinch.com/voice/apps) → your Voice app |

Copy `.env.example` to `.env` and fill in your values.

## Install and run

```bash
npm install
npm start
```

Then expose the server publicly (for local dev):

```bash
ngrok http 3000
```

Configure your Sinch Voice application's callback URLs:
- **ICE URL:** `https://<your-ngrok-url>/sinch/ice` (HTTP POST)
- **ACE URL:** `https://<your-ngrok-url>/sinch/ace` (HTTP POST)
- **DiCE URL:** `https://<your-ngrok-url>/sinch/dice` (HTTP POST)

Call your Sinch number — you'll see live transcripts in the console.

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's latest and most accurate STT model |
| `encoding` | `linear16` | 16-bit signed PCM — the format Sinch streams |
| `sample_rate` | `16000` | 16 kHz wideband audio from Sinch ConnectStream |
| `smart_format` | `true` | Auto-formats numbers, dates, currency in transcripts |
| `interim_results` | `true` | Get partial transcripts as the caller speaks |
| `utterance_end_ms` | `1000` | Detect 1 s of silence as end of utterance |

## How it works

1. An incoming call triggers Sinch to POST an ICE (Incoming Call Event) to `/sinch/ice`
2. The server responds with SVAML: an `answer` instruction, a `say` greeting, and a `connectStream` action pointing to the `/stream` WebSocket
3. Sinch opens a WebSocket to `/stream` and streams the call audio as raw 16-bit linear PCM at 16 kHz
4. The server forwards each audio frame directly to a Deepgram live transcription WebSocket
5. Deepgram returns interim and final transcript events, which the server logs to the console
6. When the call ends, Sinch closes the WebSocket and both connections clean up

## How this differs from Twilio and Vonage

| | Twilio Media Streams | Vonage Voice WebSocket | Sinch ConnectStream |
|---|---|---|---|
| Audio format | μ-law, 8 kHz | Linear16, 16 kHz | Linear16, configurable (8–16 kHz) |
| WebSocket payload | Base64 JSON | Raw binary | Raw binary |
| Call control | TwiML (XML) | NCCO (JSON) | SVAML (JSON) |
| Webhook events | Single status callback | Answer + Event URLs | ICE + ACE + DiCE |

## Related

- [Deepgram live STT docs](https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio)
- [Sinch Voice API docs](https://developers.sinch.com/docs/voice/)
- [Sinch SVAML reference](https://developers.sinch.com/docs/voice/api-reference/svaml/)
- [Sinch ConnectStream](https://developers.sinch.com/docs/voice/api-reference/voice/tag/Callbacks/)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
