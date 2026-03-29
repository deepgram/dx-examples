# Instruction: Discover New Example Opportunities

You are an agent working in the `dx-examples` repository for Deepgram. Your task is to find platforms, frameworks, and ecosystems that would benefit from a Deepgram integration example — and raise a PR for each new one you decide to build, or create queue issues for ideas you want to defer.

## Context

Deepgram provides:
- **Speech-to-text (STT)** — real-time and batch transcription
- **Text-to-speech (TTS)** — voice synthesis
- **Voice agents** — full conversational AI voice experiences
- **Audio intelligence** — summarization, sentiment, topic detection, etc.

A good example demonstrates a real integration pattern that a developer would actually use. It should be minimal but complete — not a toy, not overengineered.

**Examples are not limited to web apps.** The right form depends entirely on the use case:
- A 30-line Python script that transcribes a meeting recording from the command line
- A Flutter mobile app with a live "press to talk" button
- A Bash one-liner piped through Deepgram's REST API
- A Discord bot that transcribes voice channel recordings
- A Tauri desktop app with a floating transcription overlay
- A Jupyter notebook showing audio intelligence on a dataset
- A React Native component for voice input
- A serverless function that processes uploaded audio
- A CLI tool with subcommands wrapping the SDK

Pick the form that best matches how a developer would actually encounter this integration.

## Slugification convention

```bash
slugify() {
  echo "$1" \
    | tr '[:upper:]' '[:lower:]' \
    | sed 's/[^a-z0-9]/-/g' \
    | sed 's/-\+/-/g' \
    | sed 's/^-//;s/-$//'
}
```

## Step 1 — Read current state

1. List existing examples:
   ```bash
   ls examples/ | sort
   ```

2. Collect rejected example slugs from closed-but-unmerged PRs:
   ```bash
   gh pr list --state closed --label "type:example" \
     --json number,title,body,mergedAt --limit 200 \
     | jq '[.[] | select(.mergedAt == null)]'
   ```
   Parse `<!-- metadata ... -->` blocks in each body to extract `slug:` values. These are rejections — do not re-propose them.

3. Collect in-progress example slugs from open PRs:
   ```bash
   gh pr list --state open --label "type:example" --json title,body --limit 100
   ```

4. Collect queued example slugs from open issues:
   ```bash
   gh issue list --label "queue:new-example" --state open --json title,body --limit 100
   ```

## Step 2 — Research new integration opportunities

Search across these categories. For each, assess: does Deepgram have an existing example? Is this a real integration pattern developers need? **For each idea, also decide the best form it should take** — script, app, tool, plugin, notebook, etc.

### Terminal scripts and CLI tools
- `ffmpeg` pipeline — transcribe any local audio/video file from the terminal
- `whisper`-compatible CLI replacement using Deepgram
- Shell alias / function for quick audio transcription
- Python/Node CLI with `argparse`/`commander` — batch transcribe a folder
- `jq`-friendly output formats for scripting pipelines
- `deepgram-captions` — generate SRT/VTT from any media file

### Mobile apps
- React Native — live "press to talk" transcription component
- Flutter — voice memo app with Deepgram STT
- Swift (iOS) — AVAudioEngine → Deepgram WebSocket live transcription
- Kotlin (Android) — AudioRecord → Deepgram WebSocket
- Expo — cross-platform voice input form field

### Desktop apps
- Electron — floating live transcription overlay (always on top)
- Tauri (Rust + web frontend) — lightweight transcription desktop app
- macOS menu bar app (Swift) — transcribe clipboard audio
- Python + tkinter/PyQt — meeting recorder + transcription viewer

### Partner platforms (communications / telephony)
- Twilio Voice + Media Streams — transcribe phone calls in real-time
- Vonage / Nexmo Voice API
- Bandwidth voice API
- Zoom Phone / Meeting SDK — transcribe recordings
- Daily.co real-time audio room
- Agora voice SDK

### Voice / agent infrastructure (uses Deepgram as provider — not competitors)
- LiveKit agents — voice AI pipeline using Deepgram STT/TTS
- Pipecat voice pipeline
- Bolna voice agent framework
- Vapi.ai (uses Deepgram as STT provider)

### Chat platforms and bots
- Discord bot — transcribe voice channel recordings, slash command STT
- Slack Bolt — transcribe audio messages, `/transcribe` slash command
- Telegram bot — voice message to text
- WhatsApp Business API — voice note transcription

### AI frameworks / toolkits
- LangChain (Python and JS) — STT as a retrieval tool
- LlamaIndex — audio document processing
- Vercel AI SDK — speech streaming in Next.js
- Semantic Kernel (C#) — voice input plugin
- AutoGen / CrewAI — voice-enabled agents
- Haystack — audio intelligence pipeline
- Jupyter notebook — batch audio intelligence analysis on a dataset

### Web frontend (when a browser/UI is the right form)
- Vanilla JS + Web Audio API — no framework, pure browser STT
- React hook — `useDeepgramTranscription()` with streaming
- Vue 3 composable — `useSTT()`
- Svelte store — reactive live transcript
- Web Component — `<dg-transcript>` embeddable anywhere

### Backend / serverless (when server-side processing is the right form)
- Express.js + WebSocket — live transcription relay server
- FastAPI (Python) — async audio upload → transcript API
- Cloudflare Worker — edge transcription of audio URLs
- AWS Lambda — S3 trigger → transcribe → store in DynamoDB
- Vercel Edge Function — streaming STT for Next.js

### Integrations and plugins
- VS Code extension — dictate code or comments
- Obsidian plugin — transcribe voice notes into vault
- n8n community node — visual workflow automation
- Raycast extension — global hotkey for dictation
- Alfred workflow (macOS) — voice input anywhere
- Browser extension — transcribe any video playing in tab

### Hardware and IoT (where feasible)
- Raspberry Pi — always-listening voice command terminal
- Arduino + Python bridge — embedded wake-word + transcription

### Workflow / automation
- GitHub Actions step — transcribe recorded demos in CI
- Make.com (Integromat) custom app
- Python script — auto-caption a folder of podcast MP3s

Before researching external integrations, search Kapa to understand the current breadth
of Deepgram's own docs — this reveals which features are well-documented (good candidates
for examples) and which are sparse (opportunity to fill the gap):

```bash
kapa_search() {
  local QUERY="$1"; local LIMIT="${2:-5}"
  curl -s -X POST \
    "https://api.kapa.ai/query/v1/projects/${KAPA_PROJECT_ID}/retrieval/" \
    -H "X-API-KEY: ${KAPA_API_KEY}" \
    -H "Content-Type: application/json" \
    -d "{\"query\": $(echo "$QUERY" | jq -Rs .), \"limit\": $LIMIT}" \
  | jq -r '
    .records // .chunks // .results // . |
    if type == "array" then
      .[] | "── \(.source_url // .url // "?")\n\(.content // .text // .chunk // "")\n"
    else tojson end'
}

# Survey Deepgram's current integration landscape
kapa_search "Twilio integration speech-to-text"
kapa_search "LiveKit Pipecat voice agent"
kapa_search "LangChain Vercel AI SDK integration"
kapa_search "React Native Flutter mobile SDK"
kapa_search "Discord Slack bot transcription"
kapa_search "Node.js getting started example"
kapa_search "Python getting started example"
```

If Kapa returns detailed docs and working examples for a topic, that integration is
less urgent. If results are thin or absent, that's a strong signal it needs an example.

Also use web search and WebFetch to verify that external integrations are real and popular:
```bash
# Check npm / PyPI for relevant packages
# Check GitHub for existing examples or community projects
```

## Step 3 — Decide what to build

For each candidate integration:

1. Check it's not already in `examples/`, open PRs, open issues, or rejections
2. Assess priority (1–10):
   - 8–10: Major partner platform (Twilio, LiveKit, Pipecat, Zoom), OR a high-traffic ecosystem (Discord, Slack, LangChain, React Native), no existing Deepgram example
   - 5–7: Useful but niche, or partial coverage exists
   - Below 5: Skip
3. Pick the top 3–5 to act on this run

### Partner integrations get higher priority

Partner and ecosystem integrations — places where many developers are already building and would find Deepgram examples valuable — should score 8–10:
- **Telephony partners**: Twilio, Vonage, Bandwidth, Zoom — real-time call transcription is a high-value use case
- **Agent infrastructure**: LiveKit, Pipecat, Vapi — these use Deepgram APIs and their communities would benefit from examples
- **Chat platforms**: Discord, Slack — large developer communities with audio features
- **AI frameworks**: LangChain, LlamaIndex, Vercel AI SDK — integrating STT/TTS into AI pipelines is a growing need
- **Mobile**: React Native, Flutter — voice input in mobile apps is underserved by Deepgram examples

When multiple options are roughly equal, favour the one with the most developers using it (check npm weekly downloads, GitHub stars, official SDK/plugin existence).

## Step 4 — Find the next example number

```bash
LAST=$(ls examples/ | grep -E '^[0-9]' | sort -n | tail -1 | grep -oE '^[0-9]+')
NEXT=$(( ${LAST:-0} + 10 ))
printf "%03d" $NEXT
```

## Step 5 — For each chosen integration, create an example

Read and follow `instructions/create-example.md` for each integration.

Pass it the following context:
- Integration name and slug
- Language to use (pick the most natural language for this integration)
- Products to demonstrate (stt, tts, agent, intelligence)
- Next available example number

## Step 6 — For ideas you want to defer, create queue issues

For integrations you found but don't want to build right now (priority 5–7):

```bash
gh issue create \
  --title "Queue: {Integration} example ({language})" \
  --label "queue:new-example" \
  --body "$(cat <<'EOF'
## Integration: {Integration Name}

<!-- metadata
type: queue
slug: {slug}
language: {language}
products: {products}
priority: {score}/10
-->

### Why this is valuable
{2-3 sentences}

### Suggested approach
{Brief description of what the example should show}

### Reference
{Link to integration's documentation or SDK}

---
*Queued by discover-examples agent on {date}*
EOF
)"
```

## Rules

- Do not re-propose integrations that already exist, are in open PRs, or were rejected (closed without merge)
- Do not build examples for direct Deepgram competitors (AssemblyAI, ElevenLabs standalone, etc.)
- DO build examples for infrastructure that uses Deepgram as a provider (LiveKit, Pipecat, Vapi)
- One example per PR
- If you find 0 new opportunities, that is fine — do not raise empty PRs
- Do not modify existing examples
