# Bandwidth Real-Time Call Transcription

Transcribe live phone calls in real-time by connecting Bandwidth's media streaming to Deepgram's streaming speech-to-text API. Bandwidth is a US carrier-grade CPaaS used by enterprises for programmable voice, messaging, and 911. Every word spoken on a call is transcribed within milliseconds and printed to the console.

## What you'll build

A Node.js server that answers inbound Bandwidth voice calls using BXML, opens a WebSocket media stream via the `<StartStream>` verb, receives raw audio frames from Bandwidth, forwards them to Deepgram for live transcription, and logs both interim and final transcripts to the console.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- Bandwidth account — [sign up](https://www.bandwidth.com/)
- A Bandwidth Voice application with a phone number
- A public URL for your server (use [ngrok](https://ngrok.com/) for local development)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `BW_ACCOUNT_ID` | [Bandwidth dashboard](https://dashboard.bandwidth.com/) → Account |
| `BW_USERNAME` | [Bandwidth dashboard](https://dashboard.bandwidth.com/) → Account → API Credentials |
| `BW_PASSWORD` | [Bandwidth dashboard](https://dashboard.bandwidth.com/) → Account → API Credentials |
| `BW_VOICE_APPLICATION_ID` | [Bandwidth dashboard](https://dashboard.bandwidth.com/) → Applications |
| `BW_NUMBER` | [Bandwidth dashboard](https://dashboard.bandwidth.com/) → Phone Numbers |

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

Configure your Bandwidth Voice application's callback URLs:
- **Answer URL:** `https://<your-ngrok-url>/webhooks/answer` (POST)
- **Status URL:** `https://<your-ngrok-url>/webhooks/status` (POST)

Call your Bandwidth number — you'll see live transcripts in the console.

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's latest and most accurate speech model |
| `encoding` | `mulaw` | Matches Bandwidth's PCMU telephony audio format |
| `sample_rate` | `8000` | Standard telephony sample rate (8 kHz) |
| `smart_format` | `true` | Adds punctuation, capitalization, and number formatting |
| `interim_results` | `true` | Returns partial transcripts while the speaker is still talking |
| `utterance_end_ms` | `1000` | Fires an UtteranceEnd event after 1 second of silence |

## How it works

1. An incoming call hits the `/webhooks/answer` POST endpoint, which returns BXML with `<SpeakSentence>` (greeting) and `<StartStream>` pointing to the `/stream` WebSocket
2. Bandwidth opens a WebSocket to `/stream` and sends a `start` event with stream metadata (call ID, audio format)
3. Bandwidth streams the call audio as JSON messages with `eventType: "media"` containing base64-encoded PCMU audio
4. The server decodes each audio chunk and forwards the raw bytes to a Deepgram live transcription WebSocket
5. Deepgram returns interim and final transcript events, which the server logs to the console
6. When the call ends, Bandwidth sends a `stop` event and both WebSockets close cleanly

## Related

- [Deepgram live STT docs](https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio)
- [Bandwidth Voice API docs](https://dev.bandwidth.com/apis/voice/)
- [Bandwidth BXML reference](https://dev.bandwidth.com/docs/voice/bxml/)
- [Bandwidth media streaming](https://dev.bandwidth.com/docs/voice/guides/mediaStreaming/)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
