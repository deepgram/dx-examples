# SignalWire Real-Time Call Transcription with Deepgram STT

Transcribe live phone calls in real time using the SignalWire Realtime API and Deepgram's Nova-3 speech-to-text model. SignalWire's `tapAudio()` method streams call audio over a WebSocket directly to your server, which forwards it to Deepgram for instant transcription.

## What you'll build

A Node.js server that listens for inbound SignalWire phone calls using the RELAY Realtime SDK, taps the call audio over a WebSocket, and pipes it to Deepgram's live STT API for real-time transcription output.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- SignalWire account — [sign up](https://developer.signalwire.com/)
- A SignalWire phone number configured with a voice topic (e.g. `home`)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `SIGNALWIRE_PROJECT_ID` | SignalWire Dashboard → Settings → API |
| `SIGNALWIRE_API_TOKEN` | SignalWire Dashboard → Settings → API |

## Install and run

```bash
cp .env.example .env
# Fill in your credentials in .env

npm install
npm start
```

For SignalWire to reach your local server's `/tap` WebSocket, expose it via a tunnel:

```bash
# Example with ngrok
ngrok http 3000
# Then set TAP_URL=wss://your-ngrok-url.ngrok.io/tap in .env
```

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's latest and most accurate STT model |
| `encoding` | `mulaw` | G.711 mu-law — matches SignalWire's PCMU tap codec |
| `sample_rate` | `8000` | Standard telephony sample rate |
| `smart_format` | `true` | Auto-punctuation and number formatting |
| `interim_results` | `true` | Get partial transcripts while the speaker is still talking |
| `utterance_end_ms` | `1000` | Silence threshold before emitting an utterance boundary |

## How it works

1. The server starts an Express app with a WebSocket endpoint at `/tap`
2. A SignalWire Realtime client connects to SignalWire's RELAY servers and subscribes to voice call events on a configured topic
3. When an inbound call arrives, the SDK fires `onCallReceived` — the server answers, plays a TTS greeting, then calls `tapAudio()` to stream call audio to the `/tap` WebSocket
4. SignalWire opens a WebSocket to `/tap` and sends raw PCMU audio frames
5. The `/tap` handler opens a Deepgram live STT connection and forwards each audio frame
6. Deepgram returns transcript events (interim and final) that are logged to the console

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
