# Telnyx TeXML Stream to Deepgram Real-Time Transcription

Transcribe inbound Telnyx phone calls in real time using the TeXML `<Stream>` verb and Deepgram's live speech-to-text API. This example shows how to bridge telephony audio directly into Deepgram for low-latency transcription.

## What you'll build

A Node.js server that answers inbound Telnyx calls with TeXML, forks the call audio over a WebSocket using the `<Stream>` verb, and pipes every frame into Deepgram's live transcription WebSocket. Interim and final transcripts are logged to the console as the caller speaks.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- Telnyx account — [sign up](https://portal.telnyx.com/)
- A Telnyx phone number with a TeXML application configured to send webhooks to your server

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `TELNYX_API_KEY` | [Telnyx portal → API Keys](https://portal.telnyx.com/#/app/api-keys) |

## Install and run

```bash
cp .env.example .env
# Fill in your API keys in .env

npm install
npm start
```

Expose the server publicly so Telnyx can reach it (e.g. with ngrok):

```bash
ngrok http 3000
```

Then set your Telnyx TeXML application's voice webhook URL to `https://<ngrok-id>.ngrok.io/voice`.

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's latest and most accurate speech model |
| `encoding` | `mulaw` | Telephony standard — matches Telnyx Stream audio format |
| `sample_rate` | `8000` | 8 kHz — standard telephony sample rate |
| `smart_format` | `true` | Adds punctuation and formatting automatically |
| `interim_results` | `true` | Returns partial transcripts for low-latency display |
| `utterance_end_ms` | `1000` | Detects end-of-utterance after 1 s of silence |

## How it works

1. An inbound call hits your Telnyx phone number.
2. Telnyx sends a POST webhook to `/voice`.
3. The server responds with TeXML containing `<Stream url="wss://…/stream">`, which tells Telnyx to fork the call audio to a WebSocket.
4. Telnyx opens a WebSocket to `/stream` and sends JSON messages with base64-encoded mulaw audio in the `media` event.
5. The server decodes each audio chunk and forwards it to Deepgram's live transcription WebSocket.
6. Deepgram returns interim and final transcripts, which the server logs in real time.

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
