'use strict';

const fs = require('fs');
const path = require('path');

// ── Credential check ─────────────────────────────────────────────────────────
// Must run BEFORE any SDK imports.
//
// If DeepgramClient is constructed without an API key it will still load, but
// the first API call throws an AuthenticationError that looks like a code bug
// rather than a missing secret. Exiting here with code 2 signals to CI that
// this is an expected "not yet configured" state, not a test failure.
//
// Exit code convention used across all examples in this repo:
//   0 = all tests passed
//   1 = real test failure (code bug, assertion error, unexpected API response)
//   2 = missing credentials (expected in CI until secrets are configured)
const envExample = path.join(__dirname, '..', '.env.example');
const required = fs.readFileSync(envExample, 'utf8')
  .split('\n')
  .filter(l => /^[A-Z][A-Z0-9_]+=/.test(l.trim()))
  .map(l => l.split('=')[0].trim());

const missing = required.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`MISSING_CREDENTIALS: ${missing.join(',')}`);
  process.exit(2);
}
// ─────────────────────────────────────────────────────────────────────────────

// SDK v5: DeepgramClient (class) replaces createClient() (function) from v3/v4.
const { DeepgramClient } = require('@deepgram/sdk');

// A stable Deepgram-hosted audio file with a known transcript.
// Using dpgr.am links keeps the test deterministic — they won't disappear
// the way a random third-party URL might.
const KNOWN_AUDIO_URL = 'https://dpgr.am/spacewalk.wav';

// Words that appear in the spacewalk recording. We check for at least one
// rather than an exact match because:
//   - Minor model updates can change punctuation and capitalisation
//   - smart_format may reformat some terms over time
// An exact transcript assertion would be a brittle, maintenance-heavy test.
const EXPECTED_WORDS = ['spacewalk', 'astronaut', 'nasa'];

async function run() {
  // SDK v5: options object, not a positional string.
  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  console.log('Testing Deepgram pre-recorded STT (nova-3)...');

  // SDK v5: all options are flat in a single object.
  // SDK v5: throws on error — use try/catch, not { result, error } destructuring.
  const data = await deepgram.listen.v1.media.transcribeUrl({
    url: KNOWN_AUDIO_URL,
    model: 'nova-3',
    smart_format: true,
  });

  // Defensive optional chaining — if the response shape ever changes,
  // this throws a clear "cannot read property of undefined" pointing
  // at the exact path that changed, not a cryptic downstream error.
  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;

  if (!transcript || transcript.length < 20) {
    // A very short transcript usually means the model returned empty results,
    // which can happen with silent audio or a corrupted source file.
    throw new Error(`Transcript too short or empty: "${transcript}"`);
  }

  const lower = transcript.toLowerCase();
  const found = EXPECTED_WORDS.filter(w => lower.includes(w));
  if (found.length === 0) {
    // This would mean the model returned a plausible-looking transcript that
    // doesn't contain any of the expected words — worth investigating manually.
    throw new Error(
      `Expected words not found in transcript.\nGot: "${transcript.substring(0, 200)}"`
    );
  }

  console.log(`✓ Transcript received (${transcript.length} chars)`);
  console.log(`✓ Expected content verified (found: ${found.join(', ')})`);
  console.log(`  Preview: "${transcript.substring(0, 100)}..."`);
}

run()
  .then(() => {
    console.log('\n✓ All tests passed');
    process.exit(0);
  })
  .catch(err => {
    // Common causes if this fires in CI with credentials present:
    //   AuthenticationError  — API key valid but wrong project permissions
    //   PaymentRequiredError — quota exceeded
    //   Network error        — dpgr.am unreachable from CI runner
    console.error(`\n✗ Test failed: ${err.message}`);
    process.exit(1);
  });
