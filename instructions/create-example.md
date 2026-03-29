# Instruction: Create a New Example

You are an agent working in the `dx-examples` repository for Deepgram. Your task is to build a working example app that shows how to use a Deepgram SDK with a specific platform, framework, or ecosystem — and raise a pull request for it.

## Context

Deepgram provides:
- **STT** — `@deepgram/sdk` (Node.js/JS), `deepgram` (Python), `github.com/deepgram/deepgram-go-sdk` (Go)
- **TTS** — same SDKs
- **Voice agents** — same SDKs, WebSocket-based
- **Audio intelligence** — same SDKs

Always use the official Deepgram SDK for the chosen language. Do not make raw HTTP calls unless there is no SDK for that language.

**Always search Kapa for current SDK patterns before writing any code** — SDK APIs change significantly between major versions and your training data may be out of date. See Step 3 below.

### Current SDK API patterns (as of SDK v5 — verify with Kapa)

**Node.js / TypeScript:**
```js
const { DeepgramClient } = require('@deepgram/sdk');  // NOT createClient
const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

// Pre-recorded STT — flat single options object, NOT two arguments
const data = await deepgram.listen.v1.media.transcribeUrl({ url, model: 'nova-3', smart_format: true });
// v5 throws on error — use try/catch, NOT { result, error } destructuring
const transcript = data.results.channels[0].alternatives[0].transcript;

// Live STT
const connection = deepgram.listen.v1.live({ model: 'nova-3' });

// TTS
const response = await deepgram.speak.v1.text.speak({ text: 'Hello', model: 'aura-2-en' });
```

**Python:**
```python
from deepgram import DeepgramClient
client = DeepgramClient()  # reads DEEPGRAM_API_KEY from env automatically
response = client.listen.v1.media.transcribe_url(url=url, model='nova-3', smart_format=True)
transcript = response.results.channels[0].alternatives[0].transcript
```

**Current model names:** `nova-3` (general), `nova-3-phonecall`, `nova-3-medical` for STT; `aura-2-en` for TTS.

These patterns come from Kapa queries on 2025-03-29. **Re-run Kapa searches before writing** — method names change between major versions.

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

## Step 1 — Check the queue for work

If invoked from a queue issue, read it:
```bash
gh issue list --label "queue:new-example" --state open \
  --json number,title,body --limit 10
```

Parse `<!-- metadata ... -->` blocks to get `slug`, `language`, `products`. If no queue issue, proceed with whatever integration was provided in context.

## Step 2 — Find the next example number

```bash
LAST=$(ls examples/ | grep -E '^[0-9]' | sort -n | tail -1 | grep -oE '^[0-9]+')
NEXT=$(( ${LAST:-0} + 10 ))
PADDED=$(printf "%03d" $NEXT)
echo "Next number: $PADDED"
```

## Step 3 — Research the integration

Before writing any code, do all of the following:

### 3a. Search Deepgram docs with Kapa

Read `instructions/kapa-search.md` for the full helper function. Then search for every
Deepgram feature you'll use in this example:

```bash
# Define the helper (paste into bash before using)
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

# Search for the specific API/SDK methods you'll use — tailor these to the integration
kapa_search "pre-recorded transcription options parameters"  # if using STT batch
kapa_search "live streaming WebSocket Node.js SDK"           # if using STT live
kapa_search "text-to-speech speak synthesize options"        # if using TTS
kapa_search "voice agent WebSocket protocol messages"        # if using agents
kapa_search "audio intelligence summarization sentiment"     # if using intelligence
```

**Use the search results to verify:** method names, option key spellings, response structure,
and any gotchas called out in the docs. Write these findings into your code comments.

### 3b. Research the integration platform

```bash
# Fetch the partner/ecosystem documentation
# WebFetch the integration's quickstart or audio/voice docs page
# Find an existing SDK or package for the language chosen
```

Understand: how does audio flow through this integration? What format? What protocol?
WebSocket? HTTP chunked? Webhook? This determines which Deepgram API to use.

### 3c. Find relevant Deepgram starters to link

```bash
gh search repos --owner deepgram-starters --limit 30
# e.g. for Node.js STT: deepgram-starters/live-node, deepgram-starters/prerecorded-node
```

Identify which starters are closest to what you're building — link them from the README.

## Step 4 — Plan the example

Decide:
- **What form should this take?** — see below
- **What it demonstrates** — one clear thing (e.g. "transcribe a Twilio voice call in real-time")
- **Minimum viable scope** — enough to be useful, not exhaustive
- **Required env vars** — list every external credential needed
- **How to test it** — what assertion proves it works?

### Choosing the right form

Don't default to "web app." Pick the form that a real developer would actually use for this integration:

| If the use case is... | Consider... |
|----------------------|-------------|
| Processing audio files locally | Shell script, Python/Node CLI, Jupyter notebook |
| Real-time voice on mobile | Flutter, React Native, Swift, Kotlin app |
| Desktop dictation or transcription | Electron, Tauri, native macOS/Windows app |
| Bot in a chat platform | Discord.py, Slack Bolt, Telegram bot |
| Editor/tool integration | VS Code extension, Obsidian plugin, Raycast extension |
| Phone call / telephony | Twilio/Vonage webhook server |
| Browser-only | Vanilla HTML+JS, React component, Web Component |
| AI pipeline step | LangChain tool, LlamaIndex node, AutoGen agent |
| Serverless / cloud | Lambda function, Cloudflare Worker, Edge function |
| Hardware / IoT | Raspberry Pi script, embedded Python |

A small, focused script that does one thing well is often more useful than a full app. A 50-line Python file that transcribes any audio file passed as a CLI argument will get more real-world use than a polished React dashboard that does the same thing.

A good example scope:
- Narrow: one feature, one integration point
- Realistic: a pattern a developer would actually use
- Runnable: someone can clone it, set env vars, and run it immediately

## Step 5 — Create the branch

```bash
INTEGRATION_SLUG=$(slugify "{integration name}")
LANGUAGE_SLUG=$(slugify "{language}")
BRANCH="example/${INTEGRATION_SLUG}-${LANGUAGE_SLUG}"

git checkout main
git pull origin main
git checkout -b "$BRANCH"
```

## Step 6 — Create the example directory

```bash
EXAMPLE_DIR="examples/${PADDED}-${INTEGRATION_SLUG}-${LANGUAGE_SLUG}"
mkdir -p "${EXAMPLE_DIR}/src" "${EXAMPLE_DIR}/tests"
```

## Step 7 — Write the example

### Commenting standard — this is critical

Comments are the most valuable part of an example. A developer cloning this will read the code to understand how to adapt it. Comments must explain **why**, not what.

**Do not write:**
```js
// Create client
const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
```

**Do write:**
```js
// SDK v5: DeepgramClient constructor takes an options object, not a bare string.
// To point at a self-hosted instance add an environment option:
//   new DeepgramClient({ apiKey: '...', environment: { base: 'https://your-host.com' } })
const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
```

**Things worth commenting on in every example:**

1. **Why this approach over the obvious alternative**
   - "We use WebSocket here instead of HTTP because Twilio sends audio in chunks — polling would add 500ms+ latency per chunk"
   - "We buffer 100ms of audio before sending to avoid Deepgram receiving many tiny packets"

2. **SDK-specific gotchas**
   - "SDK v5 throws on errors — use try/catch, not `{ result, error }` destructuring (that was v3/v4)"
   - "SDK v5 options are a flat single object — `transcribeUrl({ url, model, smart_format })`, not two arguments"
   - "The Python SDK's streaming response is an async generator — you must iterate it with `async for`"
   - "`transcribeUrl()` has Deepgram fetch the URL server-side; use `transcribeFile()` for local files"

3. **Parameter choices and alternatives**
   - "nova-3 is the current general-purpose model. For phone calls: nova-3-phonecall; for medical: nova-3-medical"
   - "smart_format adds punctuation and formats numbers/dates — highly recommended, adds ~10ms"
   - "diarize: true adds speaker labels but adds ~200ms. Omit for single-speaker audio"

4. **What the response structure looks like and why**
   - "channels[0] is always present; stereo audio produces two channels"
   - "confidence is 0–1. Below 0.7 usually means poor audio quality or heavy accent"

5. **Error handling rationale**
   - "We check for missing API key before SDK init because the SDK error ('401 Unauthorized') is less clear than telling the developer exactly what to do"
   - "A 402 here means the free tier quota is exceeded, not a code bug"

6. **Integration-specific pain points**
   - "Twilio sends μ-law encoded audio by default — we convert to linear16 here because Deepgram's latency is lower with linear16"
   - "LiveKit's audio track arrives as Opus packets; the SDK handles decoding but you need to set encoding: 'opus' in the Deepgram options"

7. **Anything a senior developer would tell a junior who asked "why not just...?"**

Comments should be at the point of the code they explain, not clustered at the top. Aim for one meaningful comment per logical block, not one per line.

### Required files for every example

#### `README.md`
```markdown
# {Title}

{2-3 sentence description of what this example demonstrates and why it's useful.
Lead with the thing the developer will be able to DO, not the technology used.}

## What you'll build

{One paragraph describing the end result — what does running this code actually produce?
Be concrete: "A terminal command that prints a transcript", "A Flutter app with a live
captions view", "A Discord bot that replies to voice messages with their transcript", etc.}

## Prerequisites

- {Exact runtime and version, e.g. "Node.js 18+", "Python 3.10+", "Flutter 3.19+", "Go 1.21+"}
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- {Other service if needed} — [sign up]({url})

## Environment variables

{Skip this section entirely if only DEEPGRAM_API_KEY is needed and describe it inline.}
{If multiple vars are needed, use a table:}

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `{OTHER_VAR}` | {Exact path in the service's dashboard} |

Copy `.env.example` to `.env` and fill in your values.

## Install and run

{Exact commands that work from a fresh clone. Use the most natural form for the language.}

{Examples — pick the right one, don't use all of them:}

```bash
# Python script
pip install -r requirements.txt
python src/transcribe.py recording.mp3
```

```bash
# Node.js CLI
npm install
node src/index.js --file recording.mp3
```

```bash
# Go binary
go run ./cmd/transcribe --file recording.mp3
```

```bash
# Flutter mobile app
flutter pub get
flutter run
```

```bash
# Shell script (no install needed)
export DEEPGRAM_API_KEY=your_key_here
bash transcribe.sh recording.mp3
```

## How it works

{Step-by-step explanation of the key code — what happens when you run it?}

## Related

- [Deepgram {product} docs](https://developers.deepgram.com/docs/...)
- [{Integration} docs]({url})

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
```

#### `.env.example`
One variable per line, no values, comments allowed:
```
# Deepgram
DEEPGRAM_API_KEY=

# {Integration name}
{OTHER_VAR}=
```

#### Source code in `src/`

Write minimal but real code. Follow these principles:
- Use environment variables for all credentials (never hardcode)
- Handle errors explicitly
- Add brief inline comments where the logic isn't obvious
- Use the latest stable Deepgram SDK version for the language

#### Tests in `tests/`

**The test convention is critical.** Every test must:
1. Check for missing credentials FIRST, before doing anything else
2. Exit with code `2` if any required env var is absent — this signals "missing credentials" to CI, not a code failure
3. Exit with code `0` on success
4. Exit with code `1` on a real failure

**Node.js test pattern (`tests/test.js`):**
```javascript
'use strict';

const fs = require('fs');
const path = require('path');

// ── Credential check ────────────────────────────────────────────────────────
const envExample = path.join(__dirname, '..', '.env.example');
const required = fs.readFileSync(envExample, 'utf8')
  .split('\n')
  .filter(l => /^[A-Z][A-Z0-9_]+=/.test(l))
  .map(l => l.split('=')[0]);

const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`MISSING_CREDENTIALS: ${missing.join(',')}`);
  process.exit(2);
}
// ────────────────────────────────────────────────────────────────────────────

// SDK v5: DeepgramClient (class) replaces createClient() (function) from v3/v4.
// Verify current patterns with Kapa before writing — these change between majors.
const { DeepgramClient } = require('@deepgram/sdk');

async function run() {
  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  // SDK v5: flat single options object (not two arguments).
  // SDK v5: throws on error — use try/catch, not { result, error } destructuring.
  const data = await deepgram.listen.v1.media.transcribeUrl({
    url: 'https://dpgr.am/spacewalk.wav',
    model: 'nova-3',
    smart_format: true,
  });

  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (!transcript || transcript.length < 10) throw new Error('Transcript too short');

  console.log('✓ Integration working');
  console.log(`  Transcript preview: "${transcript.substring(0, 80)}..."`);
}

run().then(() => process.exit(0)).catch(err => {
  console.error('✗ Test failed:', err.message);
  process.exit(1);
});
```

**Python test pattern (`tests/test_example.py`):**
```python
import os
import sys
from pathlib import Path

# ── Credential check ────────────────────────────────────────────────────────
env_example = Path(__file__).parent.parent / ".env.example"
required = [
    line.split("=")[0].strip()
    for line in env_example.read_text().splitlines()
    if line and not line.startswith("#") and "=" in line and line[0].isupper()
]
missing = [k for k in required if not os.environ.get(k)]
if missing:
    print(f"MISSING_CREDENTIALS: {','.join(missing)}", file=sys.stderr)
    sys.exit(2)
# ────────────────────────────────────────────────────────────────────────────

# SDK v5 Python — verify current patterns with Kapa before writing.
# DeepgramClient() reads DEEPGRAM_API_KEY from env automatically (no arg needed).
from deepgram import DeepgramClient

def test_integration():
    client = DeepgramClient()  # reads DEEPGRAM_API_KEY from env
    # SDK v5 Python: keyword arguments, not a PrerecordedOptions object
    response = client.listen.v1.media.transcribe_url(
        url="https://dpgr.am/spacewalk.wav",
        model="nova-3",
        smart_format=True,
    )
    transcript = response.results.channels[0].alternatives[0].transcript
    assert len(transcript) > 10, "Transcript too short"
    print(f"✓ Integration working")
    print(f"  Transcript preview: '{transcript[:80]}...'")

if __name__ == "__main__":
    test_integration()
```

**Go test pattern (`tests/example_test.go`):**
```go
package tests

import (
    "os"
    "path/filepath"
    "bufio"
    "strings"
    "testing"
    // deepgram SDK imports
)

func TestCredentials(t *testing.T) {
    envFile := filepath.Join("..", ".env.example")
    f, err := os.Open(envFile)
    if err != nil {
        t.Skip("no .env.example found")
    }
    defer f.Close()
    var missing []string
    scanner := bufio.NewScanner(f)
    for scanner.Scan() {
        line := scanner.Text()
        if line == "" || strings.HasPrefix(line, "#") { continue }
        parts := strings.SplitN(line, "=", 2)
        if len(parts) < 1 || parts[0] == "" { continue }
        if os.Getenv(parts[0]) == "" { missing = append(missing, parts[0]) }
    }
    if len(missing) > 0 {
        t.Logf("MISSING_CREDENTIALS: %s", strings.Join(missing, ","))
        t.Skip("missing credentials — skipping E2E test")
    }
}
```

#### Language-specific config files

**Node.js — `package.json`:**
```json
{
  "name": "{slug}",
  "version": "1.0.0",
  "description": "{description}",
  "scripts": {
    "start": "node src/index.js",
    "test": "node tests/test.js"
  },
  "dependencies": {
    "@deepgram/sdk": "^3.0.0"
  }
}
```

Always pin to a specific major version with `^` so agents can update later.

**Python — `requirements.txt`:**
```
deepgram-sdk>=3.0.0
```

And `pyproject.toml` if the project uses it.

**Go — `go.mod`:**
```
module github.com/deepgram/dx-examples/{slug}

go 1.21

require github.com/deepgram/deepgram-go-sdk/v3 v3.x.x
```

## Step 8 — Commit and push

```bash
git add "examples/${PADDED}-${INTEGRATION_SLUG}-${LANGUAGE_SLUG}/"
git commit -m "feat(examples): add ${PADDED} — {description}"
git push origin "$BRANCH"
```

## Step 9 — Create the PR

```bash
# Create language and integration labels
gh label create "language:${LANGUAGE_SLUG}" \
  --color "bfe5bf" --description "Language: ${LANGUAGE_SLUG}" --force

gh label create "integration:${INTEGRATION_SLUG}" \
  --color "c5def5" --description "Integration: {Integration Name}" --force

PR_URL=$(gh pr create \
  --title "[Example] {NNN} — {Title}" \
  --label "type:example" \
  --label "language:${LANGUAGE_SLUG}" \
  --label "integration:${INTEGRATION_SLUG}" \
  --base main \
  --head "$BRANCH" \
  --body "$(cat <<'EOF'
## New example: {Title}

<!-- metadata
type: example
number: {NNN}
slug: {slug}
language: {language}
products: {stt|tts|agent|intelligence}
integrations: {integration-slug}
-->

**Integration:** {Integration Name}
**Language:** {Language}
**Products:** {Deepgram products demonstrated}

### What this example shows
{2-3 sentences describing the use case}

### Files added
- `examples/{NNN}-{slug}/README.md`
- `examples/{NNN}-{slug}/.env.example`
- `examples/{NNN}-{slug}/src/` — source code
- `examples/{NNN}-{slug}/tests/` — integration test

### Required secrets
{List env vars that must be configured as repo secrets for tests to pass, or "None — only DEEPGRAM_API_KEY required (already configured)"}

---
*Raised by create-example agent on {date}*
EOF
)")

# Enable auto-merge — will activate once all checks pass
PR_NUMBER=$(echo "$PR_URL" | grep -oE '[0-9]+$')
gh pr merge "$PR_NUMBER" --auto --squash

echo "PR created: $PR_URL"
```

## Step 10 — Close queue issue (if applicable)

```bash
gh issue close {issue_number} --comment "Example PR raised: $PR_URL"
```

## Step 11 — Request Copilot review

Post a comment to request Copilot code review:

```bash
gh pr comment "$PR_NUMBER" --body "@github-copilot please review this PR"
```

## Rules

- Every example must have `README.md`, `.env.example`, source in `src/`, tests in `tests/`
- Tests must implement the credential-check convention (exit 2 for missing creds)
- Never hardcode credentials or API keys
- Use the official Deepgram SDK for the chosen language
- Keep examples minimal — one integration point, clearly demonstrated
- Do not duplicate existing examples — check `examples/` and open PRs first
- The example must be genuinely useful to a developer, not just a proof of concept
