# Instruction: Fix a Failing Example

You are a debugging agent working in the `examples` repository for Deepgram. Your task is to investigate a failing test on a pull request, identify the root cause, fix it, and push the repair.

## Step 1 — Identify which PR needs fixing

Find PRs with the `status:fix-needed` label:

```bash
gh pr list --label "status:fix-needed" --state open \
  --json number,title,headRefName,labels --limit 10
```

Pick the oldest one (or the one provided in context).

## Step 2 — Read the PR

```bash
PR_NUMBER={number}
gh pr view $PR_NUMBER --json title,body,headRefName,files,labels
```

Checkout the PR branch:
```bash
BRANCH=$(gh pr view $PR_NUMBER --json headRefName --jq '.headRefName')
git fetch origin "$BRANCH"
git checkout "$BRANCH"
```

## Step 3 — Get the failure details

Find the most recent failing workflow run for this branch:

```bash
# List recent runs for this branch
gh run list --branch "$BRANCH" --status failure --limit 5 \
  --json databaseId,name,conclusion,createdAt

# Get the full log of the latest failing run
LATEST_RUN=$(gh run list --branch "$BRANCH" --status failure --limit 1 \
  --json databaseId --jq '.[0].databaseId')
gh run view "$LATEST_RUN" --log 2>&1 | tail -200
```

Also check the PR comments for review feedback that may describe issues:
```bash
gh pr view $PR_NUMBER --comments
```

Look for `<!-- fix-request` blocks in comments — these contain structured issue descriptions from the review agent.

## Step 4 — Classify the failure

Determine which type of failure this is:

### A. Missing credentials
Log contains `MISSING_CREDENTIALS:` — this is NOT a code bug. Do not push changes.
Instead, comment on the PR:
```bash
gh pr comment $PR_NUMBER --body "This failure is due to missing repository secrets, not a code bug. The `status:fix-needed` label should not have been applied here — removing it."
gh pr edit $PR_NUMBER --remove-label "status:fix-needed"
gh pr edit $PR_NUMBER --add-label "status:needs-credentials"
```

### B. Import / dependency error
Package not found, import error, `MODULE_NOT_FOUND`, etc. — dependency configuration issue.

### C. API error
`401 Unauthorized`, `403 Forbidden`, `404 Not Found`, rate limit — usually an env var or API usage issue.

### D. Logic error
Test assertion fails, wrong output, TypeError, AttributeError, etc. — code bug.

### E. Review feedback
`<!-- fix-request` block in comments — the review agent found issues.

## Step 5 — Search Kapa for current correct usage

Before reading the source code, check whether the failure might be caused by an API or
SDK change. Kapa returns up-to-date docs — if the example was written against an old
version, the fix is usually to update to the current calling convention.

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

# Tailor these queries to the actual failure — examples:
kapa_search "SDK method names response shape result error"
kapa_search "listen prerecorded transcribeUrl Node.js"
kapa_search "createClient options authentication"
kapa_search "API error codes 401 402 400"
```

Use the Kapa results to confirm what the current correct API looks like before
making any changes to the code.

## Step 6 — Investigate root cause

Read every relevant file before making any changes:

```bash
# Read the example's source files
ls examples/*/
# Read the specific example
cat examples/{NNN}-{slug}/src/index.js  # or equivalent
cat examples/{NNN}-{slug}/tests/test.js
cat examples/{NNN}-{slug}/.env.example
cat examples/{NNN}-{slug}/package.json  # or requirements.txt, go.mod
```

Cross-reference the failure log with the source code. Understand exactly why it's failing before touching anything.

## Step 6 — Fix the issue

Apply the minimum change that resolves the failure. Do not refactor unrelated code.

Common fixes:

**Dependency issues (Node.js):**
```bash
cd examples/{NNN}-{slug}
# Check the Deepgram SDK version
npm view @deepgram/sdk version
# Update package.json if needed
```

**Wrong SDK method:**
Look up the current Deepgram SDK documentation via WebFetch or WebSearch. SDK APIs change between versions. Verify the method signature.

**Test credential check:**
If the test throws before outputting `MISSING_CREDENTIALS:`, the credential check is in the wrong place. Move it to the very top of the file, before any imports that could fail.

**API response shape:**
Deepgram API responses follow a specific structure. Check the SDK docs for the correct path to the transcript:
- Node.js: `result.results.channels[0].alternatives[0].transcript`
- Python: `response.results.channels[0].alternatives[0].transcript`

**Review-requested fixes:**
Address each issue in the `<!-- fix-request -->` comment systematically.

## Step 7 — Verify the fix locally (if possible)

If `DEEPGRAM_API_KEY` is available in the local environment:
```bash
cd examples/{NNN}-{slug}
npm ci && npm test  # or python/go equivalent
```

If not available, ensure at minimum that the code is syntactically valid:
```bash
# Node.js
node --check src/index.js
node --check tests/test.js

# Python
python -m py_compile src/example.py tests/test_example.py

# Go
go vet ./...
```

## Step 8 — Commit and push

```bash
git add examples/{NNN}-{slug}/
git commit -m "fix(examples): {description of what was fixed} in {NNN}-{slug}"
git push origin "$BRANCH"
```

## Step 9 — Post a comment explaining the fix

```bash
gh pr comment $PR_NUMBER --body "$(cat <<'EOF'
## Fix applied

**Root cause:** {one sentence description}

**Change:** {what was changed and why}

Tests will re-run automatically. If they pass, this PR will auto-merge.

---
*Fix by examples agent*
EOF
)"
```

## Step 10 — Remove the fix-needed label

```bash
gh pr edit $PR_NUMBER --remove-label "status:fix-needed"
```

Removing the label allows CI to re-run. If tests fail again and a new `status:fix-needed` label is applied, this agent will run again.

## Rules

- Never remove credentials from `.env.example` or change real values
- Apply minimum necessary change — do not refactor or improve unrelated code
- If the root cause is genuinely unclear after reading the logs and code, post a comment asking for human help:
  ```bash
  gh pr comment $PR_NUMBER --body "@deepgram-devrel I've investigated this failure but can't determine the root cause. Here's what I found:\n\n{findings}\n\nPlease review."
  ```
- Do not push if the only issue is missing credentials (exit code 2 from tests)
- Maximum fix attempts implied: if the same fix has been tried before (check git log on the branch), escalate to human review instead of retrying
