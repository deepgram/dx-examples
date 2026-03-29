# Instruction: Process Open PRs

You are the primary automation loop for examples. Workflows cannot trigger
other workflows when using GITHUB_TOKEN, so this agent runs on a schedule and
is responsible for advancing every open example PR to completion.

For each open PR you will: run tests, fix failures, review code, and merge when
all checks pass. You handle the full lifecycle in a single run.

## Step 1 — Find open PRs to process

```bash
gh pr list --state open \
  --json number,title,labels,headRefName,statusCheckRollup \
  --jq '.[] | select(.title | test("^\\[(Example|Fix)\\]"))'
```

Skip PRs whose title doesn't start with `[Example]` or `[Fix]` — those are
human PRs that have their own CI.

## Step 2 — For each PR, read its full state

```bash
PR_NUMBER={number}
BRANCH=$(gh pr view $PR_NUMBER --json headRefName --jq '.headRefName')

# Full state: labels, checks, comments, merge status
gh pr view $PR_NUMBER \
  --json number,title,labels,statusCheckRollup,mergeStateStatus,mergeable,comments \
  --jq '{
    number,
    title,
    labels: [.labels[].name],
    checks: [.statusCheckRollup[] | {name: .name, state: .state, conclusion: .conclusion}],
    mergeState: .mergeStateStatus,
    mergeable: .mergeable
  }'
```

## Step 3 — Determine what action to take

Evaluate in this order:

### A. Already merged or closed → skip
```bash
STATE=$(gh pr view $PR_NUMBER --json state --jq '.state')
[ "$STATE" != "OPEN" ] && continue
```

### B. `status:needs-credentials` label → skip (waiting for human to add secrets)
The PR is blocked on missing environment variables. Leave it alone.

### C. Check if tests have run

Look at `statusCheckRollup` from Step 2.

**If empty or all pending:** Tests haven't run yet (common for bot-created PRs since
`GITHUB_TOKEN` pushes don't trigger CI). Run them manually — see Step 4.

**If any check conclusion is `FAILURE`:** Tests ran and failed.
- Check if the failure is a missing-credentials failure or a real bug:
  ```bash
  # Read the PR comments for a MISSING_CREDENTIALS notice
  gh pr view $PR_NUMBER --json comments --jq '.comments[].body' | grep -i "missing credentials"
  ```
  - If missing credentials: add label, skip (human action needed)
  - If real failure: run the fix agent — see Step 5

**If all checks are `SUCCESS`:** Tests pass. Go to Step 6 (review/merge).

### D. `status:fix-needed` label → run fix agent regardless of check state

### E. Tests pass + review done → merge (Step 7)

Only proceed to merge if ALL of the following are true:
- `status:review-passed` label is present
- `status:fix-needed` label is NOT present
- `status:needs-credentials` label is NOT present
- At least one CI check has concluded (not empty, not all pending)
- Every concluded check has conclusion `SUCCESS` — no `FAILURE`, `CANCELLED`, or `SKIPPED`

```bash
CHECKS=$(gh pr view $PR_NUMBER --json statusCheckRollup --jq '.statusCheckRollup')

# Must have at least one check that completed
CONCLUDED=$(echo "$CHECKS" | jq '[.[] | select(.conclusion != null and .conclusion != "")] | length')
# Every concluded check must be SUCCESS
FAILURES=$(echo "$CHECKS" | jq '[.[] | select(.conclusion != null and .conclusion != "SUCCESS")] | length')
# Nothing still pending
PENDING=$(echo "$CHECKS" | jq '[.[] | select(.conclusion == null or .conclusion == "")] | length')

if [ "$CONCLUDED" -eq 0 ]; then
  echo "No tests have run yet — skip merge, run tests first (Step 4)"
elif [ "$FAILURES" -gt 0 ]; then
  echo "$(echo "$CHECKS" | jq -r '.[] | select(.conclusion != "SUCCESS") | .name + ": " + .conclusion') — do not merge"
elif [ "$PENDING" -gt 0 ]; then
  echo "Tests still running — skip merge for now"
else
  echo "All $CONCLUDED checks passed — safe to merge"
  # proceed to Step 7
fi
```

## Step 4 — Run tests manually

Check out the PR branch and run the tests yourself:

```bash
git fetch origin "$BRANCH"
git checkout "$BRANCH"
```

**Detect language and run appropriate tests:**

```bash
for dir in examples/*/; do
  # Node.js
  if [ -f "${dir}package.json" ]; then
    echo "=== Testing Node.js: $dir ==="
    pushd "$dir" > /dev/null

    # Credential check
    MISSING=""
    if [ -f ".env.example" ]; then
      while IFS= read -r line; do
        [[ -z "${line// }" || "$line" == \#* ]] && continue
        VAR="${line%%=*}"; VAR="${VAR// /}"
        [ -z "$VAR" ] && continue
        [ -z "${!VAR+x}" ] || [ -z "${!VAR}" ] && MISSING="$MISSING $VAR"
      done < ".env.example"
    fi

    if [ -n "$MISSING" ]; then
      echo "Missing credentials: $MISSING"
      CRED_MISSING=true
    else
      npm ci --prefer-offline 2>/dev/null || npm install
      npm test && PASSED=true || FAILED=true
    fi

    popd > /dev/null
  fi

  # Python
  if [ -f "${dir}requirements.txt" ] || [ -f "${dir}pyproject.toml" ]; then
    echo "=== Testing Python: $dir ==="
    pushd "$dir" > /dev/null
    # Same credential check pattern
    # pip install -r requirements.txt && python -m pytest tests/ -v || python tests/*.py
    popd > /dev/null
  fi

  # Go
  if [ -f "${dir}go.mod" ]; then
    echo "=== Testing Go: $dir ==="
    pushd "$dir" > /dev/null
    # Same credential check pattern
    # go mod download && go test ./... -v
    popd > /dev/null
  fi
done
```

**After running tests, apply labels and comment:**

```bash
# If missing credentials
if [ "$CRED_MISSING" = "true" ]; then
  gh pr edit $PR_NUMBER --add-label "status:needs-credentials" 2>/dev/null || true
  # Post comment only if not already posted
  ALREADY=$(gh pr view $PR_NUMBER --json comments --jq '.comments[].body' | grep -c "Missing credentials" || true)
  if [ "$ALREADY" = "0" ]; then
    gh pr comment $PR_NUMBER --body "## ⚠️ Missing credentials — E2E tests cannot run
This PR requires repository secrets: \`$(echo $MISSING | xargs | tr ' ' ', ')\`
@deepgram-devrel please add these to [repository secrets](../../settings/secrets/actions)."
  fi
fi

# If tests failed
if [ "$FAILED" = "true" ]; then
  gh pr edit $PR_NUMBER --add-label "status:fix-needed" 2>/dev/null || true
fi
```

## Step 5 — Run the fix agent

Read and execute `instructions/fix-example.md` with `PR_NUMBER` set to this PR's number.

The fix agent will:
1. Read the failing test output
2. Search Kapa for current correct SDK usage
3. Fix the code
4. Commit and push the fix
5. Remove the `status:fix-needed` label

After the fix agent runs, re-run the tests (go back to Step 4) to verify the fix worked.
If tests now pass, continue to Step 6.

**Do not fix the same PR more than 3 times in one run.** If after 3 fix attempts tests
still fail, post a comment and move on:
```bash
gh pr comment $PR_NUMBER --body "@deepgram-devrel — unable to fix after 3 attempts. Manual review needed."
```

## Step 6 — Review the example

If tests pass but the PR doesn't have `status:review-passed` label:

Read and execute `instructions/review-example.md` with `PR_NUMBER` set.

The review agent will post a review comment and apply `status:review-passed` if everything
looks good, or `status:fix-needed` if there are issues.

## Step 7 — Merge

Only reach this step after confirming all conditions in Step 3E are met.
Do not merge if any check failed, is pending, or no checks ran at all.

```bash
# Final safety check — re-read current check state immediately before merging
CHECKS=$(gh pr view $PR_NUMBER --json statusCheckRollup --jq '.statusCheckRollup')
CONCLUDED=$(echo "$CHECKS" | jq '[.[] | select(.conclusion != null and .conclusion != "")] | length')
FAILURES=$(echo "$CHECKS" | jq '[.[] | select(.conclusion != null and .conclusion != "SUCCESS")] | length')
PENDING=$(echo "$CHECKS" | jq '[.[] | select(.conclusion == null or .conclusion == "")] | length')

if [ "$CONCLUDED" -eq 0 ] || [ "$FAILURES" -gt 0 ] || [ "$PENDING" -gt 0 ]; then
  echo "Merge blocked: concluded=$CONCLUDED failures=$FAILURES pending=$PENDING"
  exit 0   # skip merge, do not error — revisit next cron run
fi

# All checks passed — safe to merge
gh pr edit $PR_NUMBER --remove-label "status:review-passed" 2>/dev/null || true
gh pr merge $PR_NUMBER --squash --delete-branch
echo "Merged PR #$PR_NUMBER"
```

## Step 7b — Rebuild README after any merges

If you merged one or more PRs in this run, update the examples table in README.md
immediately rather than waiting for the next update-readme cron run.

```bash
# Only do this if at least one PR was merged in this run
git checkout main
git pull origin main

# Rebuild the examples table (same logic as update-readme.yml)
# Read each examples/* directory, extract title/language/products/integration
# from README.md, and rewrite the table between the markers:
# <!-- examples-table-start --> ... <!-- examples-table-end -->

# Commit only if changed
git diff --quiet README.md || (
  git add README.md
  git commit -m "docs(readme): rebuild examples table after batch merge [skip ci]"
  git push origin main
)
```

## Step 8 — Summary

After processing all PRs, post a summary to the most recent open PR or create
a GitHub Actions job summary:

```bash
echo "### PR Processing Summary — $(date -u +%Y-%m-%d)" >> $GITHUB_STEP_SUMMARY
echo "" >> $GITHUB_STEP_SUMMARY
echo "| PR | Action | Result |" >> $GITHUB_STEP_SUMMARY
echo "|----|---------|---------| " >> $GITHUB_STEP_SUMMARY
# Add one row per PR processed
```

## Rules

- Process PRs in order of oldest first (most waiting)
- **Never merge unless ALL of these are true:**
  - At least one CI check has concluded
  - Every concluded check is `SUCCESS`
  - No checks are still pending
  - `status:review-passed` label is present
  - `status:fix-needed` is NOT present
  - `status:needs-credentials` is NOT present
- If `statusCheckRollup` is empty, do not merge — run the tests first
- Never skip the final check re-read in Step 7 (state can change during the run)
- Maximum 3 fix attempts per PR per run
- If a PR can't be advanced (stuck waiting for human), leave it and move on
- Do not process more than 10 PRs per run (to keep runtime reasonable)
