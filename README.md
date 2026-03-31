# examples

A collection of working examples showing how to use Deepgram SDKs with popular platforms, frameworks, and ecosystems.

[→ Contributing](CONTRIBUTING.md) · [→ Open PRs](../../pulls) · [→ Suggest an example](../../issues/new/choose)

## Examples

<!-- examples-table-start -->
| # | Example | Language | Integration | Status |
|---|---------|----------|-------------|--------|
| [010](examples/010-getting-started-node/) | Getting Started — Transcribe a URL with Node.js | Node.js | Deepgram SDK | ✅ passing |
| [020](examples/020-twilio-media-streams-node/) | Twilio Media Streams — Real-Time Call Transcription | Node.js | Twilio | ❌ failing |
| [030](examples/030-livekit-agents-python/) | LiveKit Agents — Voice Assistant with Deepgram STT | Python | LiveKit | ❌ failing |
| [040](examples/040-langchain-stt-tool-python/) | LangChain STT Tool — Transcribe Audio in AI Pipelines | Python | LangChain | ❌ failing |
| [050](examples/050-vercel-ai-sdk-node/) | Vercel AI SDK — Transcribe Audio and Generate Speech with Deepgram | Node.js | Vercel AI SDK | ✅ passing |
| [060](examples/060-discord-bot-node/) | Discord Bot — Transcribe Audio Attachments with Deepgram | Node.js | Discord | ✅ passing |
| [070](examples/070-vonage-voice-websocket-node/) | Vonage Voice API — Real-Time Call Transcription | Node.js | Vonage | ✅ passing |
| [080](examples/080-pipecat-voice-pipeline-python/) | Pipecat Voice Pipeline — Conversational Bot with Deepgram STT & TTS | Python | Pipecat | ❌ failing |
| [090](examples/090-react-native-live-transcription-js/) | React Native Live Transcription | Node.js | React Native | ✅ passing |
| [100](examples/100-fastapi-audio-transcription-python/) | FastAPI Audio Transcription API | Python | FastAPI | ❌ failing |
| [110](examples/110-cloudflare-worker-transcription-js/) | Cloudflare Worker — Edge Audio Transcription | Node.js | Cloudflare | ✅ passing |
| [120](examples/120-slack-transcribe-bot-node/) | Slack Bot — Auto-Transcribe Audio Messages with Deepgram | Node.js | Slack | ✅ passing |
| [130](examples/130-telegram-bot-python/) | Telegram Voice Transcription Bot | Python | Telegram | ❌ failing |
| [140](examples/140-audio-to-subtitles-python/) | Audio to Subtitles CLI | Python | Deepgram SDK | ❌ failing |
| [150](examples/150-flutter-voice-transcription-dart/) | Flutter Voice Transcription | Dart | Flutter | — |
<!-- examples-table-end -->

*Status last updated 2026-03-31.*

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
