# React Native Live Transcription

Turn speech into text in real-time on iOS and Android. This example provides a React Native hook (`useDeepgramTranscription`) that streams microphone audio to Deepgram's live STT API over WebSocket, displaying both interim and final transcripts as the user speaks.

## What you'll build

A React Native screen with a "Start Listening" button that captures audio from the device microphone, streams it to Deepgram's WebSocket API, and renders a live transcript. Interim results appear in grey as the user speaks; final results replace them in black when the utterance is complete.

## Prerequisites

- Node.js 18+
- Expo CLI (`npx expo`) or React Native CLI
- iOS Simulator / Android Emulator, or a physical device (microphone access requires a real device on iOS)
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

Copy `.env.example` to `.env` and fill in your API key:

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |

## Install and run

```bash
npm install
npx expo start
```

Then press `i` for iOS simulator or `a` for Android emulator.

## How it works

1. `useDeepgramTranscription` opens a WebSocket to `wss://api.deepgram.com/v1/listen` with model, encoding, and sample rate as query parameters
2. React Native's WebSocket supports custom headers — the API key is sent as `Authorization: Token <key>` (unlike browsers, no server proxy is needed)
3. `expo-av` records audio as 16 kHz mono LINEAR16 PCM — this matches Deepgram's expected input format
4. Audio chunks are sent to the WebSocket at 250 ms intervals; Deepgram returns interim results immediately and final results when an utterance ends
5. The hook exposes `transcript` (committed finals), `interimText` (current partial), and controls (`connect`, `disconnect`, `sendAudio`, `reset`)

## Production considerations

- **Don't ship API keys in the binary.** Use a backend token endpoint that issues short-lived Deepgram API keys or proxies the WebSocket connection
- **For true real-time streaming**, use [`react-native-live-audio-stream`](https://github.com/niconicoim/react-native-live-audio-stream) instead of `expo-av` — it provides a streaming callback instead of file-based recording
- **Handle network changes** — mobile apps switch between WiFi and cellular; implement WebSocket reconnection with exponential backoff
- **Battery life** — stop the recording and close the WebSocket when the app goes to background

## Related

- [Deepgram live STT docs](https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio)
- [Deepgram JavaScript SDK](https://github.com/deepgram/deepgram-js-sdk)
- [expo-av Audio Recording](https://docs.expo.dev/versions/latest/sdk/audio/)
- [react-native-live-audio-stream](https://github.com/niconicoim/react-native-live-audio-stream)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
