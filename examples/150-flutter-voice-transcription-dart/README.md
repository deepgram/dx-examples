# Flutter Voice Transcription

Record audio on iOS or Android and transcribe it with Deepgram's nova-3 speech-to-text model. Press a button, speak, and see the transcript on screen.

## What you'll build

A Flutter app with a single screen: tap "Start Recording" to capture audio from the device microphone, tap "Stop Recording" to send the audio to Deepgram's pre-recorded STT API, and see the transcript displayed in a card below the button. The recording is WAV/LINEAR16 at 16 kHz — the format Deepgram processes most efficiently.

## Prerequisites

- Flutter 3.10+ / Dart 3.0+
- iOS Simulator / Android Emulator, or a physical device (microphone access requires a real device on iOS)
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

Copy `.env.example` to `.env` and fill in your API key:

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |

> **Production note:** Never ship API keys in mobile binaries. Use a backend endpoint that proxies Deepgram requests or issues short-lived tokens.

## Install and run

```bash
flutter pub get
flutter run
```

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's flagship STT model — best accuracy for general audio |
| `smart_format` | `true` | Adds punctuation, capitalisation, and number formatting |
| `sampleRate` | `16000` | 16 kHz mono — optimal for speech, keeps upload size small |

## How it works

1. The app requests microphone permission via `permission_handler`
2. `record` captures audio as 16 kHz mono WAV (LINEAR16 PCM)
3. On stop, the raw bytes are POSTed to `https://api.deepgram.com/v1/listen` with `Authorization: Token <key>` — there is no official Deepgram Dart SDK, so the REST API is called directly
4. The JSON response is parsed and the transcript is displayed

## Project structure

| File | Purpose |
|------|---------|
| `src/main.dart` | App entry point, loads `.env`, sets up Material theme |
| `src/transcription_screen.dart` | Recording UI — record button, transcription display |
| `src/deepgram_client.dart` | Minimal REST client wrapping Deepgram's `/v1/listen` endpoint |

## Related

- [Deepgram pre-recorded STT docs](https://developers.deepgram.com/docs/stt-pre-recorded)
- [Deepgram REST API reference](https://developers.deepgram.com/reference/listen-file)
- [record package (pub.dev)](https://pub.dev/packages/record)
- [Flutter audio recording guide](https://docs.flutter.dev/cookbook/plugins/play-video)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
