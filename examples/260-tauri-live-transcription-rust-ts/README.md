# Tauri Desktop Live Transcription

A cross-platform desktop app built with Tauri v2 that captures microphone audio, streams it to Deepgram via WebSocket for real-time transcription, and displays live captions. Tauri's Rust backend handles the Deepgram connection using the official Rust SDK, while the TypeScript frontend captures audio and renders the UI.

## What you'll build

A Tauri desktop application with a Rust backend that connects to Deepgram's live STT WebSocket using the Deepgram Rust SDK and a TypeScript frontend that captures microphone audio at 16 kHz, streams it to the backend via Tauri commands, and displays rolling live captions with interim and final results.

## Prerequisites

- [Rust](https://www.rust-lang.org/tools/install) 1.70+
- [Node.js](https://nodejs.org/) 18+
- System WebView (WebKitGTK on Linux, WebView2 on Windows, WebKit on macOS) — see [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/)
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |

## Install and run

```bash
cp .env.example .env
# Add your DEEPGRAM_API_KEY to .env

cd src
npm install
npm run tauri dev
```

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's latest and most accurate STT model |
| `encoding` | `linear16` | 16-bit PCM audio from the microphone |
| `sample_rate` | `16000` | 16 kHz — good balance of quality and bandwidth |
| `interim_results` | `true` | Show partial transcripts as the user speaks |
| `smart_format` | `true` | Auto-capitalisation, numbers, and punctuation |
| `utterance_end_ms` | `1500` | Detect end of speech after 1.5 s of silence |

## How it works

1. The Tauri app starts with a Rust backend and a web-based frontend rendered in the system WebView
2. When you click **Start**, the TypeScript frontend requests microphone access via `getUserMedia` at 16 kHz
3. A `ScriptProcessorNode` captures raw PCM audio and converts float32 samples to signed 16-bit linear PCM
4. Audio chunks are sent to the Rust backend via Tauri's `invoke("send_audio", ...)` IPC
5. The Rust backend connects to Deepgram's live STT WebSocket using the official `deepgram` Rust crate with `transcription().stream_request_with_options(...).handle()`
6. A `tokio::select!` loop multiplexes audio forwarding and transcript receiving on the same `WebsocketHandle`
7. Transcript events (interim and final) are emitted back to the frontend via Tauri's event system (`app.emit("transcript", ...)`)
8. The frontend renders rolling captions with final text in white and interim text in grey

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
