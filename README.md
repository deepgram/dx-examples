# examples

Agent-maintained examples showing how to use Deepgram SDKs with popular platforms, frameworks, and ecosystems.

**All examples are built and maintained by autonomous agents.** Humans can direct, override, and add examples at any time.

[→ Contributing](CONTRIBUTING.md) · [→ Open PRs](../../pulls) · [→ Suggest an example](../../issues/new/choose)

## How it works

1. **PM** — Discovers new integration opportunities weekly; accepts freeform suggestions from any GitHub issue
2. **Researcher** — Gathers platform SDK docs and credential requirements before building starts
3. **Engineer** — Builds the full integration (src/, tests/, .env.example, README) and opens a PR
4. **Lead — E2E** — Runs a real Deepgram API smoke test on every PR (STT + TTS)
5. **Lead — Review** — Checks code quality and verifies the integration is genuine (real SDK calls, not mocked)
6. **Lead — Fix** — If tests fail, investigates and repairs; retries up to 3 times before escalating
7. **Merge** — Once E2E passes and review is approved, the PR squash-merges automatically

PRs requiring partner credentials stay open with a `⏸` comment until secrets are configured. Every merged example has passed a real Deepgram API call.

## Examples

<!-- examples-table-start -->
| # | Example | Language | Integration | Status |
|---|---------|----------|-------------|--------|
| [010](examples/010-getting-started-node/) | Getting Started — Transcribe a URL with Node.js | Node.js | Deepgram SDK | ✅ passing |
| [020](examples/020-twilio-media-streams-node/) | Twilio Media Streams — Real-Time Call Transcription | Node.js | Twilio | ❌ failing |
| [030](examples/030-livekit-agents-python/) | LiveKit Agents — Voice Assistant with Deepgram STT | Python | LiveKit | ❌ failing |
| [040](examples/040-langchain-stt-tool-python/) | LangChain STT Tool — Transcribe Audio in AI Pipelines | Python | LangChain | ❌ failing |
| [050](examples/050-vercel-ai-sdk-node/) | Vercel AI SDK — Transcribe Audio and Generate Speech | Node.js | Vercel AI SDK | ✅ passing |
| [060](examples/060-discord-bot-node/) | Discord Bot — Transcribe Audio Attachments | Node.js | Discord | ✅ passing |
| [070](examples/070-vonage-voice-websocket-node/) | Vonage Voice API — Real-Time Call Transcription | Node.js | Vonage | ✅ passing |
| [080](examples/080-pipecat-voice-pipeline-python/) | Pipecat Voice Pipeline — Conversational Bot | Python | Pipecat | ❌ failing |
| [090](examples/090-react-native-live-transcription-js/) | React Native Live Transcription | Node.js | React Native | ✅ passing |
| [100](examples/100-fastapi-audio-transcription-python/) | FastAPI Audio Transcription API | Python | FastAPI | ❌ failing |
| [110](examples/110-cloudflare-worker-transcription-js/) | Cloudflare Worker — Edge Audio Transcription | Node.js | Cloudflare | ✅ passing |
| [120](examples/120-slack-transcribe-bot-node/) | Slack Bot — Auto-Transcribe Audio Messages | Node.js | Slack | ⏳ needs credentials |
| [130](examples/130-telegram-bot-python/) | Telegram Voice Transcription Bot | Python | Telegram | ⏳ needs credentials |
| [140](examples/140-audio-to-subtitles-python/) | Audio to Subtitles CLI | Python | Deepgram SDK | ❌ failing |
| [150](examples/140-flutter-voice-transcription-dart/) | Flutter Voice Transcription | Dart | Flutter | — |
<!-- examples-table-end -->

*Status verified by `pm-dashboard` on 2026-03-30.*

## Directory structure

```
examples/
  {NNN}-{slug}/           # e.g. 010-getting-started-node
    README.md             # What it does, prerequisites, env vars, how to run
    .env.example          # Every required environment variable (no values)
    src/                  # Source code
    tests/                # Tests — exit 0=pass, 1=fail, 2=missing credentials

instructions/             # Agent prompts — edit these to change agent behaviour
  pm.md                   # PM: discover integration opportunities
  pm-dashboard.md         # PM: rebuild README status table
  pm-suggestions.md       # PM: route any freeform issue
  researcher.md           # Researcher: gather platform context before building
  engineer.md             # Engineer: build examples
  lead-review.md          # Lead: review PRs + genuine integration check
  lead-fix.md             # Lead: fix failing tests

tests/
  e2e.py                  # Deepgram STT + TTS smoke test (runs on every PR)

.github/
  workflows/              # CI and agent workflows
  ISSUE_TEMPLATE/         # Single freeform suggestion template
  CODEOWNERS              # Protects .github/ from agent modification
```

## Numbering convention

Examples are numbered globally in increments of 10: `010`, `020`, `030` … A platform owns its group — a second Twilio example would be `021`, not a new slot. New platforms claim the next free multiple of 10.

## Language support

| Language | Test workflow | Marker file |
|----------|--------------|-------------|
| Node.js / TypeScript | `test-node.yml` | `package.json` |
| Python | `test-python.yml` | `requirements.txt` or `pyproject.toml` |
| Go | `test-go.yml` | `go.mod` |
| Java | `test-java.yml` | `pom.xml` or `build.gradle` |

## Setup

1. Add `ANTHROPIC_API_KEY` as a repository secret — required for all agent workflows
2. Add `DEEPGRAM_API_KEY` as a repository secret — required for E2E tests
3. Add partner credentials as needed (each example's `.env.example` lists them)
4. Enable **auto-merge** in repository Settings → General → Pull Requests

`GITHUB_TOKEN` is provided automatically by GitHub Actions.

## Suggesting an example

Open any GitHub issue and write whatever you like — the PM agent reads it, figures out what you mean, and routes it. No template or label required.
