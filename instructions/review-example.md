# Instruction: Review an Example PR

You are a code reviewer working in the `examples` repository for Deepgram. Your task is to review a pull request that adds a new example — checking code quality, correctness, documentation, security, and adherence to repo conventions — and post a review comment.

## Context

- PRs in this repo add working example apps showing Deepgram SDK integrations
- Examples must follow specific conventions (see CONTRIBUTING.md)
- Your review should mirror the quality of a senior engineer code review

## Step 1 — Read the PR

```bash
gh pr view $PR_NUMBER --json title,body,headRefName,files
```

Read the PR body to extract:
- What integration is being demonstrated
- What language it uses
- What Deepgram products it demonstrates

## Step 2 — Read all changed files

Read every file in the PR:
```bash
gh pr diff $PR_NUMBER
```

Also read each file individually for full context:
```bash
for f in $(gh pr view $PR_NUMBER --json files --jq '.files[].path'); do
  echo "=== $f ==="
  cat "$f"
done
```

## Step 3 — Check against this rubric

For each criterion, assess: pass / warn / fail.

### 1. Correctness
- [ ] The code would actually work if env vars are set
- [ ] The Deepgram SDK is used correctly (correct method names, options format)
- [ ] WebSocket / streaming examples handle connection lifecycle properly
- [ ] Error handling covers the main failure cases

### 2. Security
- [ ] No credentials hardcoded anywhere in source or test files
- [ ] All credentials come from `process.env` / `os.environ` / `os.Getenv`
- [ ] `.env.example` contains no real values
- [ ] No sensitive data logged

### 3. Conventions
- [ ] Directory named `{NNN}-{slug}` with correct incrementing number
- [ ] Has `README.md`, `.env.example`, `src/`, `tests/`
- [ ] Test implements the credential-check convention (exits 2 for missing creds)
- [ ] `package.json` / `requirements.txt` / `go.mod` present for language
- [ ] Language-appropriate SDK used (`@deepgram/sdk`, `deepgram`, `deepgram-go-sdk`, etc.)

### 4. Documentation quality
- [ ] README clearly describes what the example does
- [ ] README lists all required env vars with where-to-find-it guidance
- [ ] README includes working run instructions
- [ ] README explains how it works (not just what to run)
- [ ] `.env.example` lists every var in the source code that comes from env

### 5. Test quality
- [ ] Test verifies something meaningful (not just "doesn't crash")
- [ ] Test output is readable (clear pass/fail messages)
- [ ] Credential check runs before any imports that might fail without creds
- [ ] Test is deterministic (uses known audio URL like `https://dpgr.am/spacewalk.wav`)

### 6. Scope / value
- [ ] Example is minimal — shows one clear thing, not trying to be a full app
- [ ] Example is realistic — a pattern developers would actually use
- [ ] Not a duplicate of an existing example

## Step 4 — Post the review

Post a detailed review comment:

```bash
gh pr comment $PR_NUMBER --body "$(cat <<'EOF'
## Code Review

**Overall:** {APPROVED / CHANGES REQUESTED / INFORMATIONAL}

### Correctness
{Pass / findings}

### Security
{Pass / findings}

### Conventions
{Pass / findings}

### Documentation
{Pass / findings}

### Tests
{Pass / findings}

### Value
{Pass / findings}

---

{If APPROVED:}
All checks pass. Marking as reviewed — will auto-merge once CI passes. ✓

{If CHANGES REQUESTED:}
Please address the items above before this can merge. I'll re-review after the fixes are pushed.

---
*Review by examples agent*
EOF
)"
```

## Step 5 — Apply labels

```bash
# If everything looks good
gh pr edit $PR_NUMBER --add-label "status:review-passed"

# If there are issues that need fixing
gh pr edit $PR_NUMBER --add-label "status:fix-needed"
```

## Step 6 — If changes are needed, add detail to help the fix agent

If you added `status:fix-needed`, also post a structured comment the fix agent can parse:

```bash
gh pr comment $PR_NUMBER --body "$(cat <<'EOF'
<!-- fix-request
issues:
  - file: src/index.js
    line: 42
    problem: "API key read from hardcoded string instead of process.env.DEEPGRAM_API_KEY"
    fix: "Replace with process.env.DEEPGRAM_API_KEY"
  - file: tests/test.js
    line: 1
    problem: "Credential check missing — test will throw instead of exiting with code 2"
    fix: "Add credential check before any other code"
-->
EOF
)"
```

## Rules

- Be specific — cite file names and line numbers for all issues
- Distinguish blocking issues (security, broken code) from suggestions (style, improvements)
- Do not add `status:fix-needed` for minor style issues — only for things that would break the example or violate security/convention requirements
- If the example is fundamentally sound but has minor documentation gaps, approve with comments rather than blocking
- Do not approve examples that have hardcoded credentials under any circumstances
