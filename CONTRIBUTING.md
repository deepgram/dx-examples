# Contributing

## Core requirement

**Every example must use Deepgram directly or through a partner's tooling/API.**

This means Deepgram STT, TTS, Voice Agents, or Audio Intelligence must be demonstrably called — either via the Deepgram SDK, or via a partner integration that routes audio through Deepgram (e.g. LiveKit → Deepgram, Pipecat → Deepgram, Twilio → Deepgram WebSocket). Examples that use a competing speech provider, or that merely reference Deepgram without making real API calls, will be rejected.

## What makes a good example

**In scope:**
- Partners with a developer API (Twilio, Vonage, Zoom, etc.)
- AI frameworks and toolkits (LangChain, LlamaIndex, Vercel AI SDK, etc.)
- Frontend frameworks (React, Vue, Svelte, Next.js, Nuxt, etc.)
- Voice/agent infrastructure that uses Deepgram as a provider (LiveKit, Pipecat, etc.)
- Backend frameworks (FastAPI, Express, Gin, etc.)
- Platforms and clouds (AWS, GCP, Azure serverless, etc.)

**Out of scope:**
- Direct Deepgram competitors that don't use our APIs
- Trivial examples with no real integration value
- Duplicate integrations (check existing examples and open PRs first)

## Reviewing PRs

### `type:example` — New example

**Merge if:** Working, well-documented, demonstrates a real Deepgram use case.

**Close if:** Doesn't make real Deepgram API calls, uses a competing provider, is trivially simple, or duplicates an existing example.

### `type:fix` — Bug fix

**Merge if:** Resolves the failure without breaking anything else.

**Close if:** Introduces new issues or the original example should be removed instead.

## Manual contribution

1. Find the next available number:
   ```bash
   ls examples/ | sort -n | tail -1
   # Use that number + 10
   ```

2. Create the directory:
   ```bash
   mkdir -p examples/{NNN}-{slug}/{src,tests}
   ```

3. Required files:
   - `README.md` — what it does, prerequisites, env vars, how to run
   - `.env.example` — every required env var (no values, just `VAR_NAME=`)
   - Source code in `src/`
   - Tests in `tests/` — exit 0 pass, 1 fail, 2 missing credentials

4. Open a PR:
   ```bash
   git checkout -b example/{NNN}-{slug}
   git add examples/{NNN}-{slug}/
   git commit -m "feat(examples): add {description}"
   git push origin example/{NNN}-{slug}
   gh pr create --title "[Example] {NNN} — {description}" --label "type:example"
   ```

## Credential handling

If an example requires external service credentials:

1. List all required env vars in `.env.example`
2. Tests must check for missing vars and exit `2` — CI treats this as "skipped", not "failed"
3. CI will comment with the list of secrets needed
4. The PR stays open until secrets are added and tests pass

## Numbering convention

Examples are numbered globally in increments of 10. A platform owns its group — a second Twilio example gets `021`, not a new slot. New platforms claim the next free multiple of 10.

## File structure

```
examples/
  {NNN}-{slug}/
    README.md             # Required
    .env.example          # Required if any env vars needed
    src/                  # Source code
    tests/                # Tests (exit 0/1/2 convention)

.github/
  workflows/              # CI workflows
```
