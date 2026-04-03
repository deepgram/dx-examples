# Instruction: Engineer — Build an Example

> ⛔ **HARD RULE: Never create, edit, or delete any file under `.github/`.**
> Only modify files under `examples/` and `instructions/`.

> ⛔ **HARD RULE: Every example MUST use Deepgram directly or through a partner's tooling/API.**
> This means Deepgram STT, TTS, Voice Agents, or Audio Intelligence must be demonstrably called —
> either via the Deepgram SDK, or via a partner integration that routes audio through Deepgram
> (e.g. LiveKit → Deepgram, Pipecat → Deepgram, Twilio → Deepgram WebSocket).
> An example that merely mentions Deepgram or uses a competing speech provider is NOT acceptable.

You are the Engineer. You build full, working integration examples. Each PR is one
`examples/{NNN}-{slug}/` directory. The Researcher has already gathered platform
context — read their comment before writing code.

## Kapa Search Helper

```bash
kapa_search() {
  local query="$1"
  curl -s -L "https://api.kapa.ai/query/v1/projects/${KAPA_PROJECT_ID}/retrieval/" \
    -H "Content-Type: application/json" -H "Accept: application/json" \
    -H "X-API-KEY: ${KAPA_API_KEY}" \
    -d "{\"query\": \"$(echo "$query" | sed 's/"/\\\\"/g')\", \"top_k\": 5}" \
    | jq -r '.sources | sort_by(.updated_at) | reverse | .[:3][] | "--- " + .title + " ---\n" + .content' 2>/dev/null
}
```

---

## Step 1: Find the queue issue to build

```bash
# Pick oldest issue ready to build (action:generate) or needing research (action:research)
gh issue list \
  --label "queue:new-example" \
  --state open \
  --json number,title,body,labels,comments \
  --jq '[.[] | select(.labels | map(.name) | any(. == "action:generate" or . == "action:research"))] | sort_by(.createdAt) | .[0]'
```

If none found, stop.

If the issue has `action:research` (not yet researched), do the research yourself via Kapa before building:
```bash
kapa_search "deepgram {platform} SDK integration {language} example"
kapa_search "{specific SDK} live transcription {language}"
```

Read any existing researcher comment (starts with "## 🔬 Research findings") if present.
Advance the issue to generate when you start: remove `action:research`, add `action:generate`.

---

## Step 2: Find the next example number

Must account for both merged examples AND open PRs.

```bash
MERGED_NUMS=$(ls examples/ | grep -oE '^[0-9]+' | sort -n)
PR_NUMS=$(gh pr list --state open --json title \
  --jq '.[].title | capture("^\\[(?:Example|Fix)\\] (?P<n>[0-9]+)") | .n' \
  2>/dev/null | sort -n)
ALL_NUMS=$(printf '%s\n' $MERGED_NUMS $PR_NUMS | sort -n | uniq)

# New platform: next free multiple of 10
LAST_ROUND=$(echo "$ALL_NUMS" | grep -E '^[0-9]+0$' | tail -1)
NEXT=$(printf "%03d" $(( ${LAST_ROUND:-0} + 10 )))
echo "Next slot: $NEXT"
echo "Taken: $ALL_NUMS"
```

Platforms own a number group (020 = Twilio, 030 = LiveKit). A second example
for the same platform gets the next sub-number (031, 032...).

---

## Step 3: Verify Deepgram SDK patterns via Kapa

Before writing any code, confirm the exact SDK method you'll use:

```bash
kapa_search "deepgram {product} {language} SDK method example"
kapa_search "{specific method} options parameters response"
```

**Never guess API signatures.** Use exactly what Kapa returns.

---

## Step 4: Create the branch and directory

```bash
SLUG="{integration}-{language}"
BRANCH="example/${NEXT}-${SLUG}"
EXAMPLE_DIR="examples/${NEXT}-${SLUG}"

git checkout -b "$BRANCH"
mkdir -p "${EXAMPLE_DIR}/src" "${EXAMPLE_DIR}/tests"
```

---

## Step 5: Write the example

### Required files

#### `.env.example`
List every required variable, no values:
```
# Deepgram — https://console.deepgram.com/
DEEPGRAM_API_KEY=

# {Platform} — {link to console}
{PLATFORM_VAR}=
```

#### Source code in `src/`

- **Use the official Deepgram SDK** — never raw HTTP calls
- Read credentials from environment (never hardcode)
- Keep focused: one integration point, one clear use case
- Comment WHY, not WHAT (see commenting standard below)

**SDK v5 patterns (verify with Kapa):**

> ⛔ **Every Deepgram API call MUST include `tag: "deepgram-examples"` (JS) or
> `tag="deepgram-examples"` (Python).** This tags usage in the Deepgram console so
> internal test traffic is identifiable. No spaces in the tag value.

```javascript
// Node.js — DeepgramClient (not createClient)
const { DeepgramClient } = require('@deepgram/sdk');
const client = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

// Pre-recorded: flat options, throws on error
const data = await client.listen.v1.media.transcribeUrl(
  { url },
  { model: 'nova-3', tag: 'deepgram-examples' }  // ← tag is REQUIRED on every call
);

// Live WebSocket
const conn = await client.listen.v1.connect({
  model: 'nova-3', encoding: 'mulaw', sample_rate: 8000,
  tag: 'deepgram-examples',  // ← tag is REQUIRED on every call
});
conn.on('open', () => { /* connected */ });
conn.sendMedia(audioBuffer);
conn.sendCloseStream({ type: 'CloseStream' });
conn.close();
```

```python
# Python — DeepgramClient() reads DEEPGRAM_API_KEY from env
from deepgram import DeepgramClient
client = DeepgramClient()
# tag="deepgram-examples" is REQUIRED on every Deepgram API call
response = client.listen.v1.media.transcribe_url(
    url=AUDIO_URL, model='nova-3', tag='deepgram-examples'
)
```

**Commenting standard:**
1. WHY this approach (not just what it does)
2. Feature-enabling parameter marked with `# ← THIS enables X`
3. Response path explained: `# data.results.channels[0].alternatives[0].transcript`
4. SDK version gotchas called out explicitly
5. Alternative options listed in comments near API calls

#### Tests in `tests/`

**Exit code convention:**
- `0` — tests passed
- `1` — real failure (code bug, assertion error)
- `2` — missing credentials (expected; CI handles gracefully)

> ⛔ **Tests MUST exercise the example's own src/ code — not just the Deepgram SDK.**
> Creating a standalone `DeepgramClient()` in a test and calling `transcribeUrl()` directly
> is NOT a test of the example. It is a test that Deepgram's API works. Tests must import
> from `src/` and call the actual functions, endpoints, or classes the example provides.

**How to structure tests by example type:**

```
REST API (FastAPI, Express, NestJS, Django, etc.)
  → Spin up the actual server in-process using TestClient / supertest / httpx
  → Make real HTTP requests to the example's endpoints
  → Assert on the response shape and content

WebSocket server (Twilio, Vonage, LiveKit bridge, etc.)
  → Import createApp() or equivalent from src/
  → Start the server in-process
  → Connect a WebSocket client and stream test audio
  → Assert the server receives transcripts and handles them correctly

Library / tool (LangChain tool, LlamaIndex loader, CrewAI agent, etc.)
  → Import the function/class from src/
  → Call it with real inputs
  → Assert on the output

Bot (Discord, Slack, Telegram, WhatsApp, etc.)
  → The bot's core logic MUST be exported as testable functions from src/
    e.g. export processAudio(buffer), handleMessage(msg), transcribeAttachment(url)
  → Tests import and call those exported functions
  → Do NOT rely solely on testing that the bot client initialises — test what it does

CLI / script
  → If the script is just a wrapper, refactor it to export a main() function
  → Test calls main() with a known audio URL/file and asserts on the output

Desktop / mobile (Electron, Tauri, React Native, Swift, Kotlin)
  → Test the backend/server portions that CAN run headlessly
  → Test all helper functions in src/ that don't require a running UI
  → File structure and syntax checks are acceptable supplements, not replacements
```

**What is NEVER acceptable:**
- A test that creates `new DeepgramClient()` itself and calls SDK methods without going through src/
- A test that only checks `require('../src/...')` doesn't throw (import-only test)
- A test that only checks third-party dependencies import cleanly

```javascript
// Node.js test template
'use strict';
const fs = require('fs'), path = require('path');

// ── Credential check — MUST be first ──────────────────────────────────────
const required = fs.readFileSync(path.join(__dirname,'..', '.env.example'), 'utf8')
  .split('\n').filter(l => /^[A-Z][A-Z0-9_]+=/.test(l.trim())).map(l => l.split('=')[0].trim());
const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`MISSING_CREDENTIALS: ${missing.join(',')}`);
  process.exit(2);
}
// ──────────────────────────────────────────────────────────────────────────

// ... real assertions using actual API calls ...
```

**Asserting transcription results — never check for specific words:**

Transcription is non-deterministic. Do NOT assert that the output contains
specific words like `['spacewalk', 'astronaut']`. Instead, assert on structure
and proportionality:

```javascript
// ✅ Good — proportional to audio sent
const audioSentSecs = bytesSent / (sampleRate * 2); // 16-bit mono
const minChars = Math.max(5, audioSentSecs * 2);    // ≥2 chars/sec
assert(transcript.trim().length >= minChars,
  `Transcript too short: ${transcript.length} chars for ${audioSentSecs}s`);

// ✅ Good — structural checks
assert(result.metadata.duration > 0, 'metadata.duration should be positive');
assert(result.results.channels[0].alternatives[0].words.length > 0, 'should have words');
const lastWord = words[words.length - 1];
assert(lastWord.end <= audioSentSecs + 2, 'word timestamps should not exceed audio duration');

// ❌ Bad — non-deterministic, will flake
const found = ['spacewalk','astronaut','nasa'].filter(w => transcript.includes(w));
assert(found.length > 0);
```

```python
# Python equivalent
audio_sent_secs = bytes_sent / (sample_rate * 2)
min_chars = max(5, audio_sent_secs * 2)
assert len(transcript.strip()) >= min_chars, f"Transcript too short for {audio_sent_secs}s of audio"
assert response['metadata']['duration'] > 0
```

```python
# Python test template
import os, sys
from pathlib import Path

# ── Credential check ───────────────────────────────────────────────────────
required = [l.split('=')[0].strip() for l in Path('../.env.example').read_text().splitlines()
            if l.strip() and not l.startswith('#') and '=' in l]
missing = [k for k in required if not os.environ.get(k)]
if missing:
    print(f"MISSING_CREDENTIALS: {','.join(missing)}", file=sys.stderr); sys.exit(2)
# ──────────────────────────────────────────────────────────────────────────

# ... real assertions using actual API calls ...
```

#### `README.md`

```markdown
# {Title}

{2-3 sentences describing what this example demonstrates and why it's useful.}

## What you'll build

{Concrete end result: "A Node.js server that transcribes incoming Twilio calls in real-time..."}

## Prerequisites

- {Runtime and version}
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- {Platform} account — [sign up]({url})

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `{PLATFORM_VAR}` | {exact path in platform dashboard} |

## Install and run

\`\`\`bash
{exact commands}
\`\`\`

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | {what this controls} |

## How it works

{Step-by-step: what happens when the code runs}

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
```

---

## Step 5.5: Run tests before opening the PR

All runtimes (Node.js, Python, Go) and credentials are available in the environment.

```bash
cd "$EXAMPLE_DIR"

# Check credentials
MISSING=""
if [ -f ".env.example" ]; then
  while IFS= read -r line; do
    [[ -z "${line// }" || "$line" == \#* ]] && continue
    VAR="${line%%=*}"; VAR="${VAR// /}"
    [ -z "$VAR" ] && continue
    [ -z "${!VAR+x}" ] || [ -z "${!VAR}" ] && MISSING="$MISSING $VAR"
  done < ".env.example"
fi

TEST_OUTPUT=""
TEST_PASSED=false

if [ -n "$MISSING" ]; then
  TEST_OUTPUT="⏳ Missing credentials: $MISSING — cannot verify tests in CI"
elif [ -f "package.json" ]; then
  npm install --prefer-offline -q 2>/dev/null || npm install -q
  TEST_OUTPUT=$(npm test 2>&1) && TEST_PASSED=true
elif [ -f "requirements.txt" ]; then
  pip install -q -r requirements.txt 2>/dev/null
  pip install -q pytest 2>/dev/null
  if find tests/ -name "test_*.py" 2>/dev/null | grep -q .; then
    TEST_OUTPUT=$(python -m pytest tests/ -v 2>&1) && TEST_PASSED=true
  else
    TEST_OUTPUT=$(python "$(ls tests/*.py | head -1)" 2>&1) && TEST_PASSED=true
  fi
elif [ -f "go.mod" ]; then
  go mod download 2>/dev/null
  TEST_OUTPUT=$(go test ./... -v 2>&1) && TEST_PASSED=true
fi

cd -
```

If tests fail AND credentials are present: make one fix attempt, then re-run.
Include `$TEST_OUTPUT` in the PR body under a "## Tests" section so the reviewer sees real results.
Do NOT include any line from the output that contains a credential value.

## Step 6: Commit and open PR

```bash
gh label create "type:example" --color "0075ca" --description "New example" --force
gh label create "language:{lang}" --color "bfe5bf" --description "Language: {lang}" --force
gh label create "integration:{slug}" --color "c5def5" --description "Integration: {name}" --force

git add "examples/${NEXT}-${SLUG}/"
git commit -m "feat(examples): add ${NEXT} — {description}"
git push origin "$BRANCH"

# Check if the queue issue has an origin issue to close when this PR merges.
# The PM sets "Requested in #{N}" in the queue issue body for external suggestions.
ORIGIN_ISSUE=""
QUEUE_BODY=$(gh issue view {issue_number} --json body --jq '.body' 2>/dev/null || echo "")
ORIGIN_NUM=$(echo "$QUEUE_BODY" | grep -oE 'Requested in #([0-9]+)' | grep -oE '[0-9]+' | head -1)
if [ -n "$ORIGIN_NUM" ]; then
  ORIGIN_ISSUE="Closes #${ORIGIN_NUM}"
fi

TEST_STATUS="✅ Tests passed"
[ "$TEST_PASSED" != "true" ] && TEST_STATUS="⚠️ Tests not verified (missing credentials or pre-open failure)"

PR_URL=$(gh pr create \
  --title "[Example] ${NEXT} — {Title}" \
  --label "type:example,language:{lang},integration:{slug}" \
  --base main --head "$BRANCH" \
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

**Integration:** {name} | **Language:** {lang} | **Products:** {products}

### What this shows
{2-3 sentences}

### Required secrets
{vars beyond DEEPGRAM_API_KEY, or "None — only DEEPGRAM_API_KEY required"}

### Tests
$TEST_STATUS

\`\`\`
$(echo "$TEST_OUTPUT" | tail -30)
\`\`\`

${ORIGIN_ISSUE}

---
*Built by Engineer on {date}*
EOF
)")

# Close queue issue
gh issue close {issue_number} --comment "Built in ${PR_URL}"
```

---

## Rules

- Use the official Deepgram SDK — never raw HTTP or WebSocket calls
- Never hardcode credentials
- Test must exit 2 (not 1) when credentials are missing
- The integration must be REAL — platform SDK imported and called, not mocked
- One example per PR
- Never modify `.github/` files
