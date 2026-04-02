# examples

A collection of working examples showing how to use Deepgram SDKs with popular platforms, frameworks, and ecosystems.

[→ Contributing](CONTRIBUTING.md) · [→ Open PRs](../../pulls) · [→ Suggest an example](../../issues/new/choose)

## Examples

<!-- examples-table-start -->
| # | Example | Language | Integration | Status |
|---|---------|----------|-------------|--------|
| [010](examples/010-getting-started-node/) | Getting Started — Transcribe a URL with Node.js | Node.js | Deepgram SDK | ✅ passing |
| [020](examples/020-twilio-media-streams-node/) | Twilio Media Streams — Real-Time Call Transcription | Node.js | Twilio | ✅ passing |
| [021](examples/021-twilio-voice-agent-node/) | Twilio Voice + Deepgram Voice Agent — AI Phone Agent | Node.js | Twilio | ✅ passing |
| [030](examples/030-livekit-agents-python/) | LiveKit Agents — Voice Assistant with Deepgram STT | Python | LiveKit | ✅ passing |
| [040](examples/040-langchain-stt-tool-python/) | LangChain STT Tool — Transcribe Audio in AI Pipelines | Python | LangChain | ✅ passing |
| [050](examples/050-vercel-ai-sdk-node/) | Vercel AI SDK — Transcribe Audio and Generate Speech with Deepgram | Node.js | Vercel AI SDK | ✅ passing |
| [051](examples/051-nextjs-vercel-ai-sdk-streaming/) | Next.js Streaming STT + TTS with Deepgram via the Vercel AI SDK | Node.js | Vercel AI SDK | ✅ passing |
| [060](examples/060-discord-bot-node/) | Discord Bot — Transcribe Audio Attachments with Deepgram | Node.js | Discord | ✅ passing |
| [070](examples/070-vonage-voice-websocket-node/) | Vonage Voice API — Real-Time Call Transcription | Node.js | Vonage | ✅ passing |
| [080](examples/080-pipecat-voice-pipeline-python/) | Pipecat Voice Pipeline — Conversational Bot with Deepgram STT & TTS | Python | Pipecat | ✅ passing |
| [090](examples/090-expo-live-transcription-js/) | Expo Live Transcription | JavaScript | Expo | ✅ passing |
| [100](examples/100-fastapi-audio-transcription-python/) | FastAPI Audio Transcription API | Python | FastAPI | ✅ passing |
| [110](examples/110-cloudflare-worker-transcription-js/) | Cloudflare Worker — Edge Audio Transcription | Node.js | Cloudflare | ✅ passing |
| [120](examples/120-slack-transcribe-bot-node/) | Slack Bot — Auto-Transcribe Audio Messages with Deepgram | Node.js | Slack | ✅ passing |
| [130](examples/130-telegram-bot-python/) | Telegram Voice Transcription Bot | Python | Telegram | ✅ passing |
| [140](examples/140-audio-to-subtitles-python/) | Audio to Subtitles CLI | Python | Deepgram SDK | ✅ passing |
| [150](examples/150-flutter-voice-transcription-dart/) | Flutter Voice Transcription | Dart | Flutter | — |
| [160](examples/160-llamaindex-audio-loader-python/) | LlamaIndex Audio Document Loader — Transcribe Audio into RAG Pipelines | Python | LlamaIndex | ✅ passing |
| [170](examples/170-electron-live-transcription-node/) | Electron Live Transcription Overlay | Node.js | Electron | ✅ passing |
| [180](examples/180-zoom-recording-transcription-node/) | Zoom Cloud Recording Transcription with Deepgram | Node.js | Zoom | ✅ passing |
| [190](examples/190-daily-co-transcription-node/) | Daily.co Real-Time Transcription Overlay | Node.js | Daily.co | ✅ passing |
| [200](examples/200-vanilla-js-browser-transcription/) | Vanilla JavaScript Browser Transcription (No Bundler) | Node.js | Deepgram SDK | ✅ passing |
| [210](examples/210-openai-agents-voice-python/) | OpenAI Agents SDK Voice Pipeline with Deepgram STT & TTS | Python | OpenAI Agents SDK | ✅ passing |
| [220](examples/220-django-channels-live-stt-python/) | Django Channels Real-Time Transcription with Deepgram Live STT | Python | Django | ✅ passing |
| [230](examples/230-n8n-deepgram-community-node-typescript/) | n8n Community Nodes for Deepgram | Node.js | n8n | ✅ passing |
| [240](examples/240-nuxt-streaming-stt-tts-ts/) | Nuxt Streaming STT + TTS with Deepgram | Node.js | Nuxt | ✅ passing |
| [260](examples/260-nestjs-websocket-stt/) | NestJS WebSocket Real-Time Transcription | Node.js | NestJS | ✅ passing |
| [270](examples/270-sveltekit-live-transcription-ts/) | SvelteKit Real-Time Live Transcription | Node.js | SvelteKit | ✅ passing |
| [280](examples/280-express-react-live-transcription-ts/) | Express.js + React Live Transcription (TypeScript) | Node.js | Express + React | ✅ passing |
| [290](examples/290-aws-lambda-python-transcription/) | AWS Lambda Serverless Audio Transcription | Python | AWS Lambda | ✅ passing |
| [300](examples/300-spring-boot-live-transcription-java/) | Spring Boot Real-Time Transcription with Deepgram | Java | Spring Boot | — |
| [310](examples/310-crewai-voice-agents-python/) | CrewAI Voice-Enabled Multi-Agent System with Deepgram | Python | CrewAI | ✅ passing |
| [340](examples/340-tauri-live-transcription-rust-ts/) | Tauri Desktop Live Transcription | Rust | Tauri | ✅ passing |
| [350](examples/350-asterisk-freeswitch-deepgram-stt-python/) | Asterisk / FreeSWITCH PBX to Deepgram Streaming STT | Python | Asterisk/FreeSWITCH | ✅ passing |
| [360](examples/360-kotlin-android-live-transcription/) | Kotlin Android Live Transcription | Kotlin | Jetpack Compose | — |
| [370](examples/370-swift-ios-live-transcription/) | Swift iOS Live Transcription | Swift | SwiftUI | — |
<!-- examples-table-end -->

*Status last updated 2026-04-02.*

## CI / testing

Every PR that touches `examples/**` runs language-specific test jobs automatically. The `e2e-api-check` status check is required before merge.

| Language | Marker file |
|----------|-------------|
| Node.js / TypeScript | `package.json` |
| Python | `requirements.txt` or `pyproject.toml` |
| Go | `go.mod` |
| Java | `pom.xml` or `build.gradle` |
| Rust | `Cargo.toml` |
| .NET | `*.csproj` or `*.sln` |
| Dart | `pubspec.yaml` |
| Kotlin | `build.gradle.kts` |
| Swift | `Package.swift` or `*.xcodeproj` |
| CLI | `example.sh` or `src/*.sh` |

All examples are also tested on a recurring schedule to catch regressions from SDK updates or API changes.

## Directory structure

```
examples/
  {NNN}-{slug}/           # e.g. 010-getting-started-node
    README.md             # What it does, prerequisites, env vars, how to run
    .env.example          # Every required environment variable (no values)
    src/                  # Source code
    tests/                # Tests — exit 0=pass, 1=fail, 2=missing credentials

tests/
  e2e.py                  # Deepgram STT + TTS smoke test (runs on every PR)

.github/
  workflows/              # CI workflows
  ISSUE_TEMPLATE/         # Issue templates
```

## Numbering convention

Examples are numbered globally in increments of 10: `010`, `020`, `030` … A platform owns its group — a second Twilio example would be `021`, not a new slot. New platforms claim the next free multiple of 10.

## Setup

1. Add `DEEPGRAM_API_KEY` as a repository secret — required for E2E tests
2. Add partner credentials as needed (each example's `.env.example` lists them)

`GITHUB_TOKEN` is provided automatically by GitHub Actions.

## Contributing

Open an issue to suggest a new example, or submit a PR directly. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.
