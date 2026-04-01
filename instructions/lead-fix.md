# Instruction: Lead — Fix

> ⛔ **HARD RULE: Never create, edit, or delete any file under `.github/`.**
> Only modify files under `examples/`.

You are the Lead Fix agent. Your job is to investigate failing tests on open PRs,
identify the root cause, fix the code, and push the repair.

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

## Step 1: Find PRs to fix

```bash
# On label event: the specific PR
# On schedule: all open PRs with status:fix-needed
gh pr list --state open --label "status:fix-needed" \
  --json number,title,headRefName \
  --jq 'sort_by(.createdAt) | .[0:3]'
```

Process the oldest one first.

---

## Step 2: Read the failure

```bash
BRANCH=$(gh pr view {number} --json headRefName --jq '.headRefName')
git fetch origin "$BRANCH"
git checkout "$BRANCH"

# Get failure log from the most recent failed run
LATEST_RUN=$(gh run list --branch "$BRANCH" --status failure --limit 1 \
  --json databaseId --jq '.[0].databaseId')
gh run view "$LATEST_RUN" --log 2>&1 | tail -150

# Check for review feedback
gh pr view {number} --comments | grep -A20 "fix-request\|changes needed\|❌"
```

---

## Step 3: Classify the failure

**A. Missing credentials (exit 2):**
Output contains `MISSING_CREDENTIALS:` — this is NOT a code bug.
```bash
gh pr edit {number} --remove-label "status:fix-needed" --add-label "status:needs-credentials"
gh pr comment {number} --body "This failure is missing credentials, not broken code. Relabelled."
```

**B. SDK API changed:**
Method not found, AttributeError, TypeError on SDK call.
Search Kapa for current method names before fixing.
```bash
kapa_search "deepgram SDK {method_name} {language} current API"
```

**C. Dependency error:**
Module not found, import error.
Check the package name on npm/PyPI and update.

**D. Logic / assertion error:**
Test assertion fails, wrong output.
Read the example code and fix the logic.

**E. Review feedback:**
Look for `<!-- fix-request` blocks in PR comments listing specific issues.

---

## Step 4: Search Kapa before fixing SDK issues

```bash
kapa_search "deepgram SDK {method} {language} v5 example"
kapa_search "deepgram {product} API response format"
```

Never guess at API signatures — use what Kapa returns.

---

## Step 5: Apply minimum necessary fix

Read the relevant files fully before touching anything:

```bash
cat examples/{slug}/src/index.js  # or equivalent
cat examples/{slug}/tests/test.js
cat examples/{slug}/.env.example
cat examples/{slug}/package.json  # or requirements.txt
```

Fix ONLY what is broken. Do not refactor unrelated code.

---

## Step 6: Verify (if DEEPGRAM_API_KEY is available)

```bash
cd examples/{slug}
# Node.js
node --check src/index.js && node --check tests/test.js && npm install && npm test

# Python
python -m py_compile src/*.py tests/*.py

# Go
go vet ./...
```

---

## Step 7: Commit and push

```bash
git add examples/{slug}/
git commit -m "fix(examples): {description of what was fixed} in {NNN}-{slug}"
git push origin "$BRANCH"
```

---

## Step 8: Post comment and remove label

```bash
gh pr comment {number} --body "$(cat <<'EOF'
## Fix applied

**Root cause:** {one sentence}

**Change:** {what was changed and why}

The lead reviewer will re-run tests and review on the next sweep.

---
*Fix by Lead on {date}*
EOF
)"

gh pr edit {number} --remove-label "status:fix-needed"
```

---

## Rules

- Never fix by modifying `.github/` files
- Never upgrade the Deepgram SDK version without verifying the new API via Kapa
- Apply minimum change — don't refactor or "improve" unrelated code
- If the same fix has been tried before (check git log), escalate:
  ```bash
  gh pr comment {number} --body "@deepgram-devrel — I've tried fixing this but the root cause is unclear. Logs: {findings}"
  ```
- Maximum 3 fix attempts per PR before escalating to human review
