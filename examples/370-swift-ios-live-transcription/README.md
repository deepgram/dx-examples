# Swift iOS Live Transcription

A native SwiftUI iOS app that streams microphone audio to Deepgram's live speech-to-text API over WebSocket using AVAudioEngine. Displays real-time transcription with interim and final results — no third-party dependencies required.

## What you'll build

A SwiftUI screen with a microphone button that captures audio from the device microphone using AVAudioEngine, streams 16 kHz mono PCM audio to Deepgram via URLSessionWebSocketTask, and renders a live transcript. Interim results appear in grey as you speak; final results replace them in the primary text color.

## Prerequisites

- Xcode 15+ with iOS 17 SDK
- Physical iOS device (microphone access requires a real device; Simulator has limited mic support)
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) → Settings → API Keys |

## Install and run

### Option 1: Open as Swift Package

```bash
cd examples/260-swift-ios-live-transcription
open Package.swift
```

Xcode will open the package. Select an iOS device target and run.

### Option 2: Add to an existing Xcode project

1. Create a new iOS App project in Xcode (SwiftUI lifecycle)
2. Drag all files from `src/` into the project navigator
3. Merge `Info.plist` entries (microphone permission + background audio)
4. Set `DEEPGRAM_API_KEY` in your scheme's environment variables

### Setting the API key

In Xcode: **Product → Scheme → Edit Scheme → Run → Arguments → Environment Variables** — add `DEEPGRAM_API_KEY` with your key.

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's flagship STT model (2025) — best accuracy and speed |
| `encoding` | `linear16` | Raw 16-bit signed integer PCM — what AVAudioEngine produces |
| `sample_rate` | `16000` | 16 kHz — sufficient for speech; keeps bandwidth low on mobile |
| `interim_results` | `true` | Get partial transcripts while the user is still speaking |
| `utterance_end_ms` | `1000` | Silence threshold (ms) before Deepgram considers an utterance complete |
| `tag` | `deepgram-examples` | Tags traffic in the Deepgram console for identification |

## How it works

1. User taps the microphone button; `AudioCaptureManager` requests microphone permission and starts `AVAudioEngine`
2. The engine's input node tap delivers audio buffers at the hardware sample rate; `AVAudioConverter` resamples to 16 kHz mono Int16 PCM
3. `DeepgramClient` opens a WebSocket to `wss://api.deepgram.com/v1/listen` with model, encoding, and sample rate as query parameters; the API key is sent as an `Authorization: Token <key>` header
4. PCM buffers are sent as binary WebSocket frames (~100 ms chunks); Deepgram returns JSON `Results` messages with `is_final` and `speech_final` flags
5. `TranscriptionViewModel` accumulates final transcripts and shows interim partials; SwiftUI updates the view reactively

## Production considerations

- **Don't ship API keys in the binary.** Use a backend token endpoint that issues short-lived Deepgram API keys or proxies the WebSocket connection
- **Handle network transitions** — mobile apps switch between WiFi and cellular; implement WebSocket reconnection with exponential backoff
- **Battery life** — stop the audio engine and close the WebSocket when the app goes to background (`scenePhase` observer)
- **Background audio** — if you need transcription while backgrounded, enable the Audio background mode in Xcode capabilities and keep the audio session active

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
