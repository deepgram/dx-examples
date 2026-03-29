# Twilio Media Streams — Real-Time Call Transcription

Transcribe live phone calls in real-time by connecting Twilio Media Streams to Deepgram's streaming speech-to-text API. Every word spoken on a call is transcribed within milliseconds and printed to the console.

## What you'll build

An Express server with two endpoints: a Twilio webhook that returns TwiML to start a Media Stream, and a WebSocket endpoint that receives the call audio from Twilio, forwards it to Deepgram for live transcription, and logs both interim and final transcripts to the console.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- Twilio account — [sign up](https://www.twilio.com/try-twilio)
- A Twilio phone number with Voice capability
- A public URL for your server (use [ngrok](https://ngrok.com/) for local development)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `TWILIO_ACCOUNT_SID` | [Twilio console](https://console.twilio.com/) → Account Info |
| `TWILIO_AUTH_TOKEN` | [Twilio console](https://console.twilio.com/) → Account Info |
| `TWILIO_PHONE_NUMBER` | [Twilio console](https://console.twilio.com/) → Phone Numbers |

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

Configure your Twilio phone number's Voice webhook to `https://<your-ngrok-url>/voice` (HTTP POST).

Call your Twilio number — you'll see live transcripts in the console.

## How it works

1. An incoming call hits the `/voice` POST endpoint, which returns TwiML with `<Connect><Stream>` pointing back to the `/media` WebSocket
2. Twilio opens a WebSocket to `/media` and streams the call audio as base64-encoded μ-law at 8 kHz
3. The server decodes each audio chunk and forwards the raw bytes to a Deepgram live transcription WebSocket
4. Deepgram returns interim and final transcript events, which the server logs to the console
5. When the call ends, Twilio sends a `stop` event and both WebSockets close cleanly

## Related

- [Deepgram live STT docs](https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio)
- [Twilio Media Streams docs](https://www.twilio.com/docs/voice/media-streams)
- [Twilio `<Connect><Stream>` TwiML](https://www.twilio.com/docs/voice/twiml/connect)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
