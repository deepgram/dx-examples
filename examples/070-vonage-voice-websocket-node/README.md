# Vonage Voice API — Real-Time Call Transcription

Transcribe live phone calls in real-time by connecting Vonage's Voice API WebSocket to Deepgram's streaming speech-to-text API. Every word spoken on a call is transcribed within milliseconds and printed to the console.

## What you'll build

An Express server with three endpoints: a Vonage answer webhook that returns an NCCO to start a WebSocket audio stream, an event webhook for call status updates, and a WebSocket endpoint that receives raw PCM audio from Vonage and forwards it to Deepgram for live transcription.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- Vonage API account — [sign up](https://dashboard.nexmo.com/sign-up)
- A Vonage application with Voice capability and a linked phone number
- A public URL for your server (use [ngrok](https://ngrok.com/) for local development)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `VONAGE_APPLICATION_ID` | [Vonage dashboard](https://dashboard.nexmo.com/) → Applications |
| `VONAGE_PRIVATE_KEY_PATH` | Path to the private key file downloaded when creating the Vonage app |

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

Configure your Vonage application's webhooks:
- **Answer URL:** `https://<your-ngrok-url>/webhooks/answer` (HTTP GET)
- **Event URL:** `https://<your-ngrok-url>/webhooks/event` (HTTP POST)

Call your Vonage number — you'll see live transcripts in the console.

## How it works

1. An incoming call hits the `/webhooks/answer` endpoint, which returns an NCCO (Nexmo Call Control Object) with a `connect` action pointing to the `/socket` WebSocket
2. Vonage opens a WebSocket to `/socket` and streams the call audio as raw 16-bit linear PCM at 16 kHz
3. The server forwards each audio frame directly to a Deepgram live transcription WebSocket — no base64 decoding or JSON parsing needed
4. Deepgram returns interim and final transcript events, which the server logs to the console
5. When the call ends, Vonage closes the WebSocket and both connections clean up

## How this differs from the Twilio example

| | Twilio Media Streams | Vonage Voice WebSocket |
|---|---|---|
| Audio format | μ-law, 8 kHz | Linear16 PCM, 16 kHz |
| WebSocket payload | Base64 JSON (`message.media.payload`) | Raw binary frames |
| Call control | TwiML (XML) | NCCO (JSON) |
| Audio quality | Lower (telephony-grade) | Higher (wideband) |

The higher sample rate and raw binary format make Vonage slightly more efficient — less CPU on the server and better accuracy from Deepgram.

## Related

- [Deepgram live STT docs](https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio)
- [Vonage Voice API docs](https://developer.vonage.com/en/voice/voice-api/overview)
- [Vonage WebSocket docs](https://developer.vonage.com/en/voice/voice-api/concepts/websockets)
- [NCCO reference](https://developer.vonage.com/en/voice/voice-api/ncco-reference)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
