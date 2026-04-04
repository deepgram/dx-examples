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

User-submitted suggestions take priority over bot-queued examples. Check in order:

```bash
# 1. First: user-submitted suggestions (priority:user label)
USER_ISSUE=$(gh issue list \
  --label "queue:new-example,action:generate,priority:user" \
  --state open \
  --json number,title,body,labels,comments \
  --jq 'sort_by(.createdAt) | .[0]')

# 2. Fallback: regular bot-queued examples (no priority:user)
BOT_ISSUE=$(gh issue list \
  --label "queue:new-example" \
  --state open \
  --json number,title,body,labels,comments \
  --jq '[.[] | select(
    (.labels | map(.name) | any(. == "action:generate" or . == "action:research")) and
    (.labels | map(.name) | contains(["priority:user"]) | not)
  )] | sort_by(.createdAt) | .[0]')

ISSUE=$([ -n "$USER_ISSUE" ] && [ "$USER_ISSUE" != "null" ] && echo "$USER_ISSUE" || echo "$BOT_ISSUE")
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

## Supply-chain security — required for every example

Examples are public code that users clone and run directly. Follow these rules for every
new example — they protect users from compromised or malicious dependencies.

### Node.js (pnpm / bun / deno)

**`package.json`** — exact versions only, no `^` or `~`; pin the package manager itself:
```json
{
  "packageManager": "pnpm@9.6.0",
  "dependencies": {
    "@deepgram/sdk": "3.9.0",
    "express": "4.21.2"
  }
}
```

**`.npmrc`** in the example root — prevents accidental range saves:
```
save-exact=true
```

Commit `pnpm-lock.yaml` (or `bun.lockb` / `deno.lock`). Run before pushing:
```bash
pnpm audit --audit-level=high   # or: bun audit / deno audit
```

### Python

**`requirements.txt`** — `==` pins only, never `>=` or `~=`:
```
deepgram-sdk==3.10.0
fastapi==0.115.6
uvicorn==0.34.0
```

For examples with more than 3 dependencies, use **pip-tools hash pinning**:
```bash
# requirements.in — unpinned names only
deepgram-sdk
fastapi
uvicorn

# Generate requirements.txt with per-package sha256 hashes:
pip install pip-tools
pip-compile --generate-hashes requirements.in

# Install with hash verification (use this command in the README too):
pip install --require-hashes -r requirements.txt
```

Run before pushing:
```bash
pip install pip-audit
pip-audit -r requirements.txt
```

### Go

Commit both `go.mod` and `go.sum`. `go.sum` contains cryptographic checksums for every
downloaded module — Go's built-in integrity guarantee.

```bash
go mod tidy      # prune unused deps, update go.sum
go mod verify    # re-verify local cache against go.sum checksums
```

### Java

**Maven `pom.xml`** — exact versions only, never version ranges:
```xml
<!-- ✅ exact -->
<version>3.4.0</version>

<!-- ❌ never — a range silently pulls in newer/malicious versions -->
<version>[3.0,4.0)</version>
```

**Gradle** — exact versions, and commit generated verification metadata:
```groovy
// build.gradle — exact version, no dynamic selectors
implementation 'com.deepgram:deepgram-java-sdk:3.4.0'
```
```bash
# Generates gradle/verification-metadata.xml — commit this file:
./gradlew --write-verification-metadata sha256
```

### Rust

Commit `Cargo.lock`. Use the `=` prefix for exact SemVer pinning in `Cargo.toml`:
```toml
[dependencies]
deepgram = "=0.6.0"   # = means exact; without it Cargo allows patch-level drift
```

Run before pushing:
```bash
cargo install cargo-audit
cargo audit
```

### .NET

Enable the NuGet lock file — add to every `*.csproj`:
```xml
<PropertyGroup>
  <RestorePackagesWithLockFile>true</RestorePackagesWithLockFile>
</PropertyGroup>
```

Exact versions in all package references — no floating wildcards:
```xml
<PackageReference Include="Deepgram" Version="3.4.0" />
```

Commit `packages.lock.json`. Run before pushing:
```bash
dotnet list package --vulnerable
```

---

## Step 5.5: Audit, install, test — fix until passing

All runtimes and credentials are available. **Never run install before auditing.**
Iterate through the audit → install → test cycle, fixing issues each round, up to **3 attempts total**.
Only proceed to Step 6 when both audit and tests are clean.

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
ATTEMPT=0
MAX_ATTEMPTS=3

if [ -n "$MISSING" ]; then
  TEST_OUTPUT="⏳ Missing credentials: $MISSING — cannot verify tests in CI"
else
  while [ $ATTEMPT -lt $MAX_ATTEMPTS ]; do
    ATTEMPT=$((ATTEMPT + 1))
    echo "── Attempt $ATTEMPT/$MAX_ATTEMPTS ──"

    # ── 1. AUDIT — always before install ───────────────────────────────────
    AUDIT_OK=true
    if [ -f "pnpm-lock.yaml" ]; then
      pnpm audit --audit-level=high 2>&1 || AUDIT_OK=false
    elif [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
      bun audit 2>&1 || AUDIT_OK=false
    elif [ -f "requirements.txt" ]; then
      pip-audit -r requirements.txt 2>&1 || AUDIT_OK=false
    elif [ -f "Cargo.toml" ]; then
      cargo audit 2>&1 || AUDIT_OK=false
    elif [ -f "go.mod" ]; then
      go mod verify 2>&1 || AUDIT_OK=false
    fi

    if [ "$AUDIT_OK" = "false" ]; then
      echo "⚠ Audit failed — fixing vulnerable dependencies before continuing"
      # Fix: identify and update the vulnerable packages to safe versions,
      # regenerate the lockfile, then loop back to re-audit.
      if [ $ATTEMPT -ge $MAX_ATTEMPTS ]; then
        TEST_OUTPUT="Audit still failing after $MAX_ATTEMPTS attempts — fix vulnerable deps"
        break
      fi
      continue
    fi

    # ── 2. INSTALL — only after audit passes ───────────────────────────────
    if [ -f "pnpm-lock.yaml" ]; then
      pnpm install --frozen-lockfile
    elif [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
      bun install --frozen-lockfile
    elif [ -f "deno.json" ] || [ -f "deno.jsonc" ]; then
      : # deno fetches on demand, no separate install step
    elif [ -f "requirements.txt" ]; then
      pip install -q -r requirements.txt
      pip install -q pytest
    elif [ -f "go.mod" ]; then
      go mod download
    elif [ -f "Cargo.toml" ]; then
      : # cargo test fetches on demand
    else
      echo "ERROR: No supported lockfile found. Node.js examples must use pnpm, bun, or deno — not npm or yarn."
      break
    fi

    # ── 3. TEST ────────────────────────────────────────────────────────────
    if [ -f "pnpm-lock.yaml" ]; then
      TEST_OUTPUT=$(pnpm test 2>&1) && TEST_PASSED=true && break
    elif [ -f "bun.lockb" ] || [ -f "bun.lock" ]; then
      TEST_OUTPUT=$(bun test 2>&1) && TEST_PASSED=true && break
    elif [ -f "deno.json" ] || [ -f "deno.jsonc" ]; then
      TEST_OUTPUT=$(deno test 2>&1) && TEST_PASSED=true && break
    elif [ -f "requirements.txt" ]; then
      if find tests/ -name "test_*.py" 2>/dev/null | grep -q .; then
        TEST_OUTPUT=$(python -m pytest tests/ -v 2>&1) && TEST_PASSED=true && break
      else
        TEST_OUTPUT=$(python "$(ls tests/*.py | head -1)" 2>&1) && TEST_PASSED=true && break
      fi
    elif [ -f "go.mod" ]; then
      TEST_OUTPUT=$(go test ./... -v 2>&1) && TEST_PASSED=true && break
    elif [ -f "Cargo.toml" ]; then
      TEST_OUTPUT=$(cargo test 2>&1) && TEST_PASSED=true && break
    fi

    echo "⚠ Tests failed — fixing code issues before re-running"
    [ $ATTEMPT -ge $MAX_ATTEMPTS ] && { TEST_OUTPUT="Tests still failing after $MAX_ATTEMPTS attempts"; break; }
    # Fix: read TEST_OUTPUT, identify the failing assertion or error, edit src/ or tests/, then loop.
  done
fi

cd -
```

**Fix cycle rules:**
- Audit failure → update the specific vulnerable package to a safe version, regenerate the lockfile, re-audit. Do not update unrelated packages.
- Test failure → read the full `TEST_OUTPUT`, edit the minimal code needed to fix the assertion, re-test.
- After 3 failed attempts → stop and document the blocker in the PR; do not open a PR with a clean test status when tests actually failed.
- Never downgrade the audit level to make a failure disappear.

Include `$TEST_OUTPUT` in the PR body under a "## Tests" section.
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
- **Node.js examples must use pnpm, bun, or deno — never npm or yarn.** Default to pnpm. Use bun when the example targets Bun's runtime specifically. Use deno when the example targets Deno. Every Node.js example must ship with the appropriate lockfile (`pnpm-lock.yaml`, `bun.lockb`, or `deno.lock`).
