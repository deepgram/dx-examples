# Instruction: PM — Dashboard

> ⛔ **HARD RULE: Never create, edit, or delete any file under `.github/`.**
> Only modify `README.md`.

You are the PM Dashboard agent. Run the example test suite, rebuild the README
examples table with live status, and open a PR if anything changed.

---

## Step 1: Get current test status from last test-existing run

Do NOT run tests yourself — test-existing runs every 6 hours and has already tested everything.
Read its results from the last workflow run instead.

```bash
# Get the last test-existing run ID
RUN_ID=$(gh run list --repo {repo} --workflow=test-existing.yml   --status=completed --limit=1 --json databaseId --jq '.[0].databaseId')

# For each example, check if it appears in failed_examples output of that run
# If an example dir was in node/python/go/java failures → "failing"
# If it was skipped (missing credentials) → "needs credentials"  
# Otherwise → "passing"

# Simpler: scan the existing examples directory and build status from
# open PRs (status:fix-needed = failing, status:needs-credentials = needs creds)
# and merged examples that have no open fix PRs = passing

declare -A STATUS

for dir in examples/*/; do
  [ ! -d "$dir" ] || [ -f "${dir}.gitkeep" ] && continue
  EXAMPLE=$(basename "$dir")
  SLUG="${EXAMPLE#*-}"

  # Check for an open fix PR
  HAS_FIX=$(gh pr list --repo {repo} --state open     --search "$SLUG" --label "status:fix-needed"     --json number --jq 'length' 2>/dev/null || echo "0")

  # Check for needs-credentials
  HAS_CREDS=$(gh pr list --repo {repo} --state open     --search "$SLUG" --label "status:needs-credentials"     --json number --jq 'length' 2>/dev/null || echo "0")

  LANG=""
  [ -f "${dir}package.json" ]     && LANG="node"
  [ -f "${dir}requirements.txt" ] && LANG="python"
  [ -f "${dir}go.mod" ]           && LANG="go"
  [ -z "$LANG" ] && STATUS[$EXAMPLE]="—" && continue

  if [ "$HAS_FIX" != "0" ]; then
    STATUS[$EXAMPLE]="failing"
  elif [ "$HAS_CREDS" != "0" ]; then
    STATUS[$EXAMPLE]="needs-credentials"
  else
    STATUS[$EXAMPLE]="passing"
  fi
done
```
---

## Step 2: Read current README and rebuild table

Status emoji:
- `✅ passing` — tests ran and passed
- `❌ failing` — tests ran and failed (see logs)
- `⏳ needs credentials` — missing secrets
- `—` — no tests found

For each example directory, read its README.md to extract:
- Title (first H1)
- Language (from package.json/requirements.txt/go.mod)
- Integration (from directory slug)
- Products (from README body: STT, TTS, agent, intelligence)

Replace the content between these markers:
```
<!-- examples-table-start -->
...
<!-- examples-table-end -->
```

New table format:
```markdown
<!-- examples-table-start -->
| # | Example | Language | Integration | Status |
|---|---------|----------|-------------|--------|
| [010](examples/010-getting-started-node/) | Getting started — Node.js | Node.js | Deepgram SDK | ✅ passing |
<!-- examples-table-end -->
```

---

## Step 3: Exit if nothing changed

```bash
git diff --quiet README.md && echo "README unchanged" && exit 0
```

---

## Step 4: Open PR (or update existing one)

Use a single persistent branch so there is never more than one open README PR.
If a PR already exists for this branch, push the update to it in place.

```bash
BRANCH="chore/examples-status-update"

git checkout -B "$BRANCH"
git add README.md
git commit -m "docs: update examples status table [skip ci]"

# Check for an already-open PR on this branch
EXISTING_PR=$(gh pr list --repo {repo} --head "$BRANCH" --state open \
  --json number --jq '.[0].number')

if [ -n "$EXISTING_PR" ]; then
  # Update the existing PR by force-pushing — same PR, new content
  git push --force-with-lease origin "$BRANCH"
  echo "Updated existing PR #$EXISTING_PR"
else
  git push origin "$BRANCH"
  gh pr create \
    --title "docs: update examples status table" \
    --body "Automated dashboard update. No code changes." \
    --base main --head "$BRANCH"
  echo "Created new PR"
fi
```
