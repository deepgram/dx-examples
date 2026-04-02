# Kotlin Android Live Transcription

A native Android app built with Kotlin and Jetpack Compose that captures microphone audio and streams it to Deepgram for real-time speech-to-text transcription. Interim results appear as you speak, and finalized text accumulates on screen.

## What you'll build

A Kotlin Android app with a single-screen Jetpack Compose UI: tap "Start Recording" to capture 16 kHz mono PCM audio from the device microphone, stream it over WebSocket to Deepgram's live transcription API using the official Java SDK, and see both interim (partial) and final transcription results displayed in real time.

## Prerequisites

- Android Studio Hedgehog (2023.1.1) or later
- Android SDK 26+ (Android 8.0 Oreo)
- A physical Android device (emulator microphone input is unreliable)
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

Copy `.env.example` to `.env` and fill in your key:

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |

Pass the key to the build via Gradle property or environment variable:

```bash
# Option 1: environment variable
export DEEPGRAM_API_KEY="your-key-here"

# Option 2: gradle.properties (local.properties for per-machine config)
echo "DEEPGRAM_API_KEY=your-key-here" >> local.properties
```

> **Production note:** Never ship API keys in mobile binaries. Use a backend proxy that issues short-lived Deepgram temporary keys.

## Install and run

```bash
# Clone and open in Android Studio
cd examples/260-kotlin-android-live-transcription
# Set your API key
export DEEPGRAM_API_KEY="your-key-here"
# Build and install on connected device
./gradlew installDebug
```

Or open the project in Android Studio, set the `DEEPGRAM_API_KEY` in `local.properties`, and press Run.

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's flagship STT model — best accuracy for general audio |
| `encoding` | `linear16` | Raw PCM 16-bit — matches Android's AudioRecord output directly |
| `sample_rate` | `16000` | 16 kHz mono — optimal for speech, keeps bandwidth low |
| `interim_results` | `true` | Shows partial transcripts while the user is still speaking |
| `smart_format` | `true` | Adds punctuation, capitalization, and number formatting |
| `tag` | `deepgram-examples` | Identifies example traffic in the Deepgram console |

## How it works

1. The app requests `RECORD_AUDIO` permission via the Jetpack Compose permission launcher
2. `AudioRecorder` creates an `AudioRecord` instance at 16 kHz mono LINEAR16 and emits ~100ms chunks as a Kotlin `Flow<ByteArray>`
3. `TranscriptionViewModel` creates a `DeepgramClient` using the API key from `BuildConfig`
4. The SDK's `V1WebSocketClient` opens a WebSocket to `wss://api.deepgram.com/v1/listen` with nova-3 model, linear16 encoding, and `tag=deepgram-examples`
5. Audio chunks from the `Flow` are sent to the WebSocket via `ws.send(bytes)`
6. The `onResults` callback receives both interim and final transcription results
7. Interim text is shown in italics; finalized text is appended to the main transcript
8. Tapping "Stop" cancels the coroutine, closes the WebSocket, and stops `AudioRecord`

## Project structure

| File | Purpose |
|------|---------|
| `app/src/main/.../MainActivity.kt` | Entry point — sets Compose content |
| `app/src/main/.../TranscriptionScreen.kt` | Compose UI — record button, live transcript display |
| `app/src/main/.../TranscriptionViewModel.kt` | Connects AudioRecorder → Deepgram WebSocket → UI state |
| `app/src/main/.../AudioRecorder.kt` | Wraps Android AudioRecord as a Kotlin Flow of PCM chunks |
| `app/build.gradle.kts` | Dependencies including `deepgram-java-sdk:0.2.0` |

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
