# Electron Live Transcription Overlay

A desktop overlay that transcribes microphone audio in real-time using Deepgram's live STT API. The transparent, always-on-top window displays rolling captions — useful for accessibility, meetings, or any scenario where live captions are needed on the desktop.

## What you'll build

An Electron app that captures microphone input, streams it to Deepgram's live WebSocket STT API using the Node.js SDK, and displays a floating transparent overlay with real-time captions. The overlay stays on top of all windows and supports click-through so it never blocks your workflow.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |

## Install and run

```bash
cp .env.example .env
# Add your DEEPGRAM_API_KEY to .env

npm install
npm start
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

1. Electron creates a frameless, transparent, always-on-top `BrowserWindow` positioned at the bottom of the screen
2. When you click **Start**, the renderer requests microphone access via `getUserMedia` at 16 kHz
3. A `ScriptProcessorNode` captures raw PCM audio and converts float32 samples to linear16
4. Audio chunks are sent to the main process via IPC (`contextBridge` + `ipcRenderer`)
5. The main process connects to Deepgram's live STT WebSocket using `client.listen.v1.connect()` and forwards audio
6. Transcript events (interim and final) stream back and are displayed in the overlay
7. The overlay supports click-through (`setIgnoreMouseEvents`) so it never blocks interaction with other apps
8. Use **Ctrl+Shift+T** (or **Cmd+Shift+T** on macOS) to toggle overlay visibility

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
