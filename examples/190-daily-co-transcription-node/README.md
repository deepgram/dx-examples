# Daily.co Real-Time Transcription Overlay

Add live captions to Daily.co video calls using Deepgram's streaming speech-to-text. This example creates a web app that joins a Daily.co room and overlays real-time transcriptions with speaker diarization — ideal for accessibility, meeting notes, or telehealth applications.

## What you'll build

A Node.js server that creates Daily.co rooms on the fly, serves a browser client that joins the video call, captures microphone audio, streams it to Deepgram for real-time transcription, and displays live captions as an overlay on top of the video call with speaker labels.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- Daily.co account — [sign up](https://dashboard.daily.co/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `DAILY_API_KEY` | [Daily.co dashboard → Developers](https://dashboard.daily.co/developers) |

## Install and run

```bash
cp .env.example .env
# Add your DEEPGRAM_API_KEY and DAILY_API_KEY to .env

npm install
npm start
```

Then open `http://localhost:3000` in your browser.

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's latest and most accurate STT model |
| `encoding` | `linear16` | 16-bit PCM audio from the browser microphone |
| `sample_rate` | `16000` | 16 kHz — good balance of quality and bandwidth |
| `interim_results` | `true` | Show partial transcripts while the user is still speaking |
| `smart_format` | `true` | Auto-capitalisation, numbers, and punctuation |
| `diarize` | `true` | Identify different speakers in the transcription |
| `utterance_end_ms` | `1500` | Detect end of speech after 1.5 s of silence |

## How it works

1. User clicks "Start Call" — the server creates a temporary Daily.co room via the REST API
2. The browser joins the Daily.co room using the Daily.co JavaScript SDK (`DailyIframe`)
3. Simultaneously, the browser opens a WebSocket to the server's `/transcribe` endpoint
4. The browser captures microphone audio via `getUserMedia` and a `ScriptProcessorNode`, converting float32 samples to linear16 PCM
5. PCM audio chunks are streamed over the WebSocket to the server
6. The server forwards audio to Deepgram's live STT API using `client.listen.v1.live()` with the `@deepgram/sdk`
7. Deepgram returns interim and final transcript events, which the server relays back to the browser
8. The browser displays captions as a floating overlay on top of the Daily.co video call, with speaker labels from diarization
9. Final transcripts are appended to a scrolling transcript panel on the right

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
