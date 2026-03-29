# examples

Agent-maintained examples showing how to use Deepgram SDKs with popular platforms, frameworks, and ecosystems.

**All examples are built and maintained by autonomous agents.** Humans can direct, override, and add examples at any time.

[→ Contributing](CONTRIBUTING.md) · [→ Open PRs](../../pulls) · [→ Request an example](../../issues/new/choose)

## How it works

1. **Discover** — Agents scan for new platforms and ecosystems weekly, queuing example ideas
2. **Create** — Agents build working example apps with tests and documentation, raising PRs
3. **Review** — Agents self-review their PRs; Copilot review also runs automatically
4. **Test** — Language-specific CI workflows run the example's tests
5. **Fix** — If tests fail for fixable reasons, the fix agent pushes a repair and tests retry
6. **Merge** — Auto-merge activates once all checks pass

If an example requires external credentials that aren't configured as repository secrets, the PR stays open with a comment tagging `@deepgram-devrel` listing exactly what's needed. Every example in the commit history represents a complete contribution → review → fix → merge lifecycle.

## Examples

<!-- examples-table-start -->
| # | Example | Language | Integration | Status |
|---|---------|----------|-------------|--------|
| [010](examples/010-getting-started-node/) | Getting Started — Transcribe a URL with Node.js | Node.js | Deepgram SDK | ✅ passing |
| [020](examples/020-twilio-media-streams-node/) | Twilio Media Streams — Real-Time Call Transcription | Node.js | Twilio Media Streams | ❌ failing |
| [030](examples/030-livekit-agents-python/) | LiveKit Agents — Voice Assistant with Deepgram STT | Python | LiveKit Agents | ❌ failing |
| [040](examples/040-langchain-stt-tool-python/) | LangChain STT Tool — Transcribe Audio in AI Pipelines | Python | LangChain | ❌ failing |
| [050](examples/050-vercel-ai-sdk-node/) | Vercel AI SDK — Transcribe Audio and Generate Speech with Deepgram | Node.js | Vercel AI SDK | ✅ passing |
| [060](examples/060-discord-bot-node/) | Discord Bot — Transcribe Audio Attachments with Deepgram | Node.js | Discord | ✅ passing |
| [070](examples/070-vonage-voice-websocket-node/) | Vonage Voice API — Real-Time Call Transcription | Node.js | Vonage Voice API | ✅ passing |
| [080](examples/080-pipecat-voice-pipeline-python/) | Pipecat Voice Pipeline — Conversational Bot with Deepgram STT & TTS | Python | Pipecat | ❌ failing |
| [090](examples/090-react-native-live-transcription-js/) | React Native Live Transcription | Node.js | React Native | ✅ passing |
| [100](examples/100-fastapi-audio-transcription-python/) | FastAPI Audio Transcription API | Python | FastAPI | ❌ failing |
| [110](examples/110-cloudflare-worker-transcription-js/) | Cloudflare Worker — Edge Audio Transcription | Node.js | Cloudflare Workers | ✅ passing |
| [120](examples/120-slack-transcribe-bot-node/) | Slack Bot — Auto-Transcribe Audio Messages with Deepgram | Node.js | Slack | ⏳ needs credentials |
| [130](examples/130-telegram-bot-python/) | Telegram Voice Transcription Bot | Python | Telegram | ⏳ needs credentials |
| [140](examples/140-audio-to-subtitles-python/) | Audio to Subtitles CLI | Python | Deepgram SDK | ❌ failing |
| [140](examples/140-flutter-voice-transcription-dart/) | Flutter Voice Transcription | Dart | Flutter | — |
<!-- examples-table-end -->

## Directory structure

```
examples/
  {NNN}-{slug}/           # e.g. 010-getting-started-node, 020-twilio-voice-agent-node
    README.md             # What it does, prerequisites, env vars, how to run
    .env.example          # Every required environment variable (no values)
    src/                  # Source code
    tests/                # Tests — must exit 0 on success, 1 on failure, 2 on missing credentials

instructions/             # Agent prompts — edit these to change agent behaviour
  discover-examples.md
  create-example.md
  review-example.md
  fix-example.md

.github/
  workflows/              # CI workflows (tests, agents, auto-merge)
  ISSUE_TEMPLATE/         # Queue new examples or report broken ones
```

## Numbering convention

Examples are numbered globally in increments of 10: `010`, `020`, `030` … The number appears as the directory name prefix. Gaps are intentional — they allow future insertions without renumbering.

## Language support

| Language | Test workflow | Marker file |
|----------|--------------|-------------|
| Node.js / TypeScript | `test-node.yml` | `package.json` |
| Python | `test-python.yml` | `requirements.txt` or `pyproject.toml` |
| Go | `test-go.yml` | `go.mod` |
| Rust | `test-rust.yml` | `Cargo.toml` |
| .NET / C# | `test-dotnet.yml` | `*.csproj` |

## Setup

1. Add `ANTHROPIC_API_KEY` as a repository secret — required for all agent workflows
2. Add `DEEPGRAM_API_KEY` as a repository secret — required for E2E tests
3. Add partner credentials as needed (each example's `.env.example` lists them)
4. Enable **auto-merge** in repository Settings → General → Pull Requests
5. Configure branch protection on `main` to require status checks before merging

`GITHUB_TOKEN` is provided automatically by GitHub Actions.

## Running agents locally

```bash
# Requires: ANTHROPIC_API_KEY set, gh auth login done, git configured
claude --model claude-opus-4-6 -p "$(cat instructions/discover-examples.md)"
claude --model claude-opus-4-6 -p "$(cat instructions/create-example.md)"
```
