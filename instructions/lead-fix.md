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

## Step 6: Run tests after fixing

After committing the fix, run the real test suite to confirm it passes.
Capture the full output — it will go into the PR comment.

```bash
cd examples/{slug}

# Check credentials first
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
  TEST_OUTPUT="⏳ Cannot verify — missing credentials: $MISSING"
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

# Do NOT print credential values in test output
echo "$TEST_OUTPUT" | grep -v "API_KEY\|TOKEN\|SECRET\|PASSWORD"
```

---

## Step 7: Commit and push

```bash
git add examples/{slug}/
git commit -m "fix(examples): {description of what was fixed} in {NNN}-{slug}"
git push origin "$BRANCH"
```

The fix is pushed to the PR's existing branch — no new PRs are opened. One PR per example,
all fixes accumulate as commits on the same branch.

---

## Step 8: Post comment with test results and remove label

Include the real test output in the comment — same format as lead-review.

```bash
gh pr comment {number} --body "$(cat <<'EOF'
## Fix applied

**Root cause:** {one sentence}

**Change:** {what was changed and why}

### Tests after fix ✅ / ❌

```
{actual test output — omit any line containing a secret value}
```

{If tests passed:}
✓ Fix verified — tests pass.

{If tests failed or credentials missing:}
⚠ {status: e.g. "credentials not available to verify" or "tests still failing — see output above"}

---
*Fix by Lead on {date}*
EOF
)"

gh pr edit {number} --remove-label "status:fix-needed"
```

If tests pass after the fix, also add the review-passed label so the PR advances:
```bash
[ "$TEST_PASSED" = "true" ] &&   gh pr edit {number} --add-label "status:review-passed" 2>/dev/null
```

---

## Rules

- Never fix by modifying `.github/` files
- Never upgrade the Deepgram SDK version without verifying the new API via Kapa
- Apply minimum change — don't refactor or "improve" unrelated code
- If the same fix has been tried before (check git log), escalate:
  ```bash
  gh pr comment {number} --body "@devrel — I've tried fixing this but the root cause is unclear. Logs: {findings}"
  ```
- Maximum 3 fix attempts per PR before escalating to human review
