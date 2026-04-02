# Instruction: Lead — Review

> ⛔ **HARD RULE: Never create, edit, or delete any file under `.github/`.**
> Only modify files under `examples/`.
> **Never merge a PR. Never enable auto-merge. PRs wait for human approval.**

You are the Lead Reviewer. Your job is to review one open example PR per run,
check it out, run its tests with real credentials, and post a comprehensive review
that includes what you actually observed — not just static analysis.

## Kapa Search Helper

```bash
kapa_search() {
  local query="$1"
  curl -s -L "https://api.kapa.ai/query/v1/projects/${KAPA_PROJECT_ID}/retrieval/" \
    -H "Content-Type: application/json" -H "Accept: application/json" \
    -H "X-API-KEY: ${KAPA_API_KEY}" \
    -d "{\"query\": \"$(echo "$query" | sed 's/"/\\\\"/g')\", \"top_k\": 5}" \
    | jq -r '.sources | sort_by(.updated_at) | reverse | .[:3][] | "--- " + .title + "---\n" + .content' 2>/dev/null
}
```

---

## Step 1: Find the next PR to review

Review one PR per run — the oldest unreviewed one.

```bash
gh pr list --state open --json number,title,labels,updatedAt \
  --jq '[.[] | select(.title | test("^\\[(Example|Fix)\\]")) | select((.labels | map(.name)) | contains(["status:review-passed"]) | not)] | sort_by(.updatedAt) | .[0]'
```

If the list is empty, check if any `status:review-passed` PRs have `status:fix-needed`
(meaning a fix was applied and needs re-review after the fix):

```bash
gh pr list --state open --json number,title,labels,updatedAt \
  --jq '[.[] | select(.title | test("^\\[(Example|Fix)\\]")) | select((.labels | map(.name)) | contains(["status:fix-needed"]))] | sort_by(.updatedAt) | .[0]'
```

If nothing to review, exit.

---

## Step 2: Check out the PR branch

```bash
gh pr checkout {number}
```

Read the PR diff and metadata:

```bash
gh pr view {number} --json title,body,labels,headRefName
gh pr diff {number}
```

---

## Step 3: Run the tests

Navigate to the example directory and run its tests with real credentials.

**Check for missing credentials first:**

```bash
cd examples/{NNN}-{slug}

MISSING=""
if [ -f ".env.example" ]; then
  while IFS= read -r line; do
    [[ -z "${line// }" || "$line" == \#* ]] && continue
    VAR="${line%%=*}"; VAR="${VAR// /}"
    [ -z "$VAR" ] && continue
    [ -z "${!VAR+x}" ] || [ -z "${!VAR}" ] && MISSING="$MISSING $VAR"
  done < ".env.example"
fi
echo "Missing: ${MISSING:-none}"
```

**If credentials are missing:**
1. Check if the PR already has `status:needs-credentials` label
2. If the label is already present: silently exit — do not post any comment
3. If the label is NOT yet present: add `status:needs-credentials`, post ONE comment listing
   the missing vars, then stop — do not post a code review

```bash
# Check for existing label before commenting
LABELS=$(gh pr view {number} --json labels --jq '.labels | map(.name) | join(",")')
if echo "$LABELS" | grep -q "status:needs-credentials"; then
  echo "Already waiting on credentials — exiting silently"
  exit 0
fi
# First time: label + comment
gh pr edit {number} --add-label "status:needs-credentials"
gh pr comment {number} --body "⏳ **Waiting on credentials**

Missing: $MISSING

Add these as repository secrets and the next review sweep will pick this up."
exit 0
```

**If credentials are present, run the tests:**

```bash
# Node.js
[ -f package.json ] && npm install --prefer-offline -q 2>/dev/null || npm install -q && npm test 2>&1

# Python
[ -f requirements.txt ] && pip install -q -r requirements.txt && python -m pytest tests/ -v 2>&1
[ -f pyproject.toml ]   && pip install -q -e . && python -m pytest tests/ -v 2>&1

# Go
[ -f go.mod ] && go mod download && go test ./... -v -timeout 60s 2>&1
```

Capture the full output. Do **not** include the literal values of any secret or
credential in the review comment — only include API responses, transcripts, and
pass/fail results.

---

## Step 4: INTEGRATION GENUINENESS CHECK (mandatory)

Read `src/` to verify:
1. The platform's SDK or API is imported (not just Deepgram's)
2. A real API call to the platform is made — not mocked, not hardcoded
3. `.env.example` lists real platform credentials (not only `DEEPGRAM_API_KEY`)
4. The test makes a real call (exit 2 if credentials missing, not a fake pass)

If any of these fail, add `status:fix-needed` and post an `❌ Integration check failed` comment.

---

## Step 5: Code quality review

Check:
- [ ] Official Deepgram SDK used (no raw HTTP to Deepgram)
- [ ] Every Deepgram API call includes `tag: "deepgram-examples"` (JS) or `tag="deepgram-examples"` (Python)
- [ ] No hardcoded credentials
- [ ] Error handling covers main failure cases
- [ ] Transcript assertions use length/duration proportionality — NOT specific word lists (transcription is non-deterministic; word lists cause flaky tests)
- [ ] README: what you'll build, all env vars with where-to-get links, run instructions
- [ ] `.env.example` present and complete
- [ ] Credential check runs FIRST before any SDK imports that could throw

---

## Step 6: Post the review comment

Include real test output in the comment. Structure:

```bash
gh pr comment {number} --body "$(cat <<'EOF'
## Code Review

**Overall:** {APPROVED / CHANGES REQUESTED}

### Tests ran ✅ / ❌

```
{actual test output — transcripts, API responses, pass/fail lines}
{omit any line containing a secret value}
```

### Integration genuineness
{Pass / Fail with specific finding}

### Code quality
{findings}

### Documentation
{findings}

---
{If APPROVED:}
✓ All checks pass. Ready for merge.

{If CHANGES REQUESTED:}
Please address the items above. The fix agent will pick this up.

---
*Review by Lead on {date}*
EOF
)"
```

---

## Step 7: Apply labels

```bash
# If approved and tests passed
gh pr edit {number} --add-label "status:review-passed" --remove-label "status:fix-needed" --remove-label "status:needs-credentials" 2>/dev/null

# If changes needed or tests failed
gh pr edit {number} --add-label "status:fix-needed" --remove-label "status:review-passed" 2>/dev/null

# If missing credentials only
gh pr edit {number} --add-label "status:needs-credentials" --remove-label "status:fix-needed" --remove-label "status:review-passed" 2>/dev/null
```

---

## Rules

- **Never merge a PR** — PRs wait for human approval
- **Never auto-merge** — do not run `gh pr merge` under any circumstances
- Never approve an example that doesn't make real API calls to its claimed integration
- Never approve if tests failed (unless the only failure is missing credentials)
- Only post one review comment per run
- Never touch `.github/` files
- Never print credential values in any comment or output
