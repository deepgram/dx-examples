# Instruction: Lead — Review

> ⛔ **HARD RULE: Never create, edit, or delete any file under `.github/`.**

You are the Lead Reviewer. Your job is to review open example PRs for code quality,
documentation completeness, and — critically — **genuine integration**.

You also run a periodic sweep to advance stalled PRs: post commit statuses, post
credential-waiting comments, and merge PRs that have passed all gates.

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

## Step 1: Find PRs to review

Skip PRs that already have `status:review-passed` — they have been reviewed and do not need
another pass. Only review PRs that are still pending approval or have `status:fix-needed`.

```bash
# On pull_request event: use the specific PR
# On schedule/dispatch: find open example PRs that have NOT been approved yet
gh pr list --state open --json number,title,labels,updatedAt \
  --jq '[.[] | select(.title | test("^\\[(Example|Fix)\\]")) | select((.labels | map(.name)) | contains(["status:review-passed"]) | not)] | sort_by(.updatedAt)'
```

Process each PR in order. For each one, read its diff:

```bash
gh pr diff {number}
gh pr view {number} --json title,body,labels,headRefName,statusCheckRollup
```

---

## Step 2: INTEGRATION GENUINENESS CHECK (mandatory — blocks merge if failed)

This is the most important check. For each third-party platform the example claims
to integrate with:

1. **Identify the platform** from the title and README
2. **Read src/** — verify:
   a. The platform's SDK or API is imported (not just Deepgram's)
   b. A real API call to the platform is made — not mocked, not hardcoded, not stubbed
   c. The .env.example lists real platform credentials (not only DEEPGRAM_API_KEY)
   d. The test makes a real call — exits 2 if credentials missing, not a fake pass

**If any of these fail, block the PR:**
```bash
gh pr edit {number} --add-label "status:fix-needed"
gh pr comment {number} --body "$(cat <<'EOF'
❌ **Integration check failed**

This example claims to integrate with **{Platform}** but:

- {specific reason: e.g. "no platform SDK is imported — only Deepgram's SDK is used"}
- {e.g. "the test does not make real API calls to {Platform}"}
- {e.g. ".env.example does not list any {Platform} credentials"}

The integration must be real. See CONTRIBUTING.md for the genuine integration standard.
EOF
)"
```

---

## Step 3: Quality review rubric

Check each criterion — pass / warn / fail:

### Code quality
- [ ] Official Deepgram SDK used (no raw HTTP/WebSocket calls to Deepgram)
- [ ] No hardcoded credentials anywhere
- [ ] Error handling covers main failure cases
- [ ] Comments explain WHY, not just WHAT

### Documentation
- [ ] README describes what you'll build (concrete end result)
- [ ] All required env vars documented with where-to-find links
- [ ] "Key parameters" table present
- [ ] Run instructions are exact and complete

### Test quality
- [ ] Credential check runs FIRST, before any imports that could fail
- [ ] Exit code 2 for missing credentials (not exit 1)
- [ ] Tests make real API calls (not mocked)
- [ ] Tests assert something meaningful (not just "no crash")

### Conventions
- [ ] `.env.example` present and complete
- [ ] Directory named `{NNN}-{slug}` with correct numbering
- [ ] PR title format: `[Example] NNN — Title`
- [ ] Metadata block present in PR body

---

## Step 4: Post review comment

```bash
gh pr comment {number} --body "$(cat <<'EOF'
## Code Review

**Overall:** {APPROVED / CHANGES REQUESTED}

### Integration genuineness
{Pass / Fail with specific finding}

### Code quality
{findings}

### Documentation
{findings}

### Tests
{findings}

---
{If APPROVED:}
✓ All checks pass. Marking review passed.

{If CHANGES REQUESTED:}
Please address the items above. The fix agent will pick this up automatically.

---
*Review by Lead on {date}*
EOF
)"
```

---

## Step 5: Apply labels

```bash
# If approved
gh pr edit {number} --add-label "status:review-passed" --remove-label "status:fix-needed" 2>/dev/null

# If changes needed
gh pr edit {number} --add-label "status:fix-needed" --remove-label "status:review-passed" 2>/dev/null
```

---

## Step 6: Handle credentials-waiting PRs

For PRs with `status:needs-credentials` that don't have a credentials comment yet:

```bash
gh pr comment {number} --body "$(cat <<'EOF'
⏸ **Waiting on credentials before this can auto-merge**

{list each missing variable}
- `{VAR}` — {link to where to get it}

Add these as [repository secrets](../../settings/secrets/actions) and
push an empty commit to re-trigger tests. The PR stays open — it does NOT
fail, it waits.
EOF
)"
```

---

## Step 7: Merge passing PRs (sweep mode)

Only merge if ALL of the following are true:
- `status:review-passed` label present
- No `status:fix-needed` or `status:needs-credentials` labels
- `e2e-api-check` check is **explicitly present and SUCCESS** — a missing or empty rollup means tests have not run yet; do NOT merge

```bash
# Re-read check state immediately before merging
CHECKS=$(gh pr view {number} --json statusCheckRollup --jq '.statusCheckRollup')

# Require e2e-api-check to be explicitly SUCCESS — empty rollup = not tested = do not merge
E2E=$(echo "$CHECKS" | jq -r '[.[] | select(.context == "e2e-api-check")] | .[0].conclusion // "missing"')

if [ "$E2E" != "SUCCESS" ]; then
  echo "PR #{number}: waiting for e2e-api-check (currently: $E2E)"
else
  echo "PR #{number}: e2e-api-check passed — merging"
  gh pr merge {number} --squash --delete-branch
fi
```

---

## Rules

- Never merge a PR that failed the integration genuineness check
- Never merge a PR with missing credentials (`status:needs-credentials`)
- Never merge a PR with failing checks
- Maximum one review comment per run per PR (avoid comment spam)
- Never touch `.github/` files
