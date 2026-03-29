'use strict';

const fs = require('fs');
const path = require('path');

// ── Credential check ─────────────────────────────────────────────────────────
// Exit code convention across all examples in this repo:
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

// Test the Deepgram REST API directly — the same way the Worker calls it.
// We can't run the Worker runtime in CI, but we can verify that the API
// interaction pattern works (same endpoint, same headers, same response parsing).

const DG_API_BASE = 'https://api.deepgram.com/v1/listen';
const KNOWN_AUDIO_URL = 'https://dpgr.am/spacewalk.wav';
const EXPECTED_WORDS = ['spacewalk', 'astronaut', 'nasa'];

async function testRestApiUrlTranscription() {
  console.log('Testing Deepgram REST API — URL transcription...');

  // This mirrors the Worker's handleTranscribeUrl logic exactly:
  // POST to /v1/listen?model=nova-3&smart_format=true with a JSON body.
  const params = new URLSearchParams({ model: 'nova-3', smart_format: 'true' });
  const response = await fetch(`${DG_API_BASE}?${params}`, {
    method: 'POST',
    headers: {
      // "Token" scheme, not "Bearer" — Deepgram-specific.
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: KNOWN_AUDIO_URL }),
  });

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Deepgram API returned ${response.status}: ${errorBody}`);
  }

  const data = await response.json();
  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;

  if (!transcript || transcript.length < 20) {
    throw new Error(`Transcript too short or empty: "${transcript}"`);
  }

  const lower = transcript.toLowerCase();
  const found = EXPECTED_WORDS.filter(w => lower.includes(w));
  if (found.length === 0) {
    throw new Error(
      `Expected words not found in transcript.\nGot: "${transcript.substring(0, 200)}"`
    );
  }

  console.log(`✓ REST API transcription working (${transcript.length} chars)`);
  console.log(`✓ Expected content verified (found: ${found.join(', ')})`);
  console.log(`  Preview: "${transcript.substring(0, 100)}..."`);
}

async function testResponseStructure() {
  console.log('\nTesting response structure matches Worker output format...');

  const params = new URLSearchParams({ model: 'nova-3', smart_format: 'true' });
  const response = await fetch(`${DG_API_BASE}?${params}`, {
    method: 'POST',
    headers: {
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: KNOWN_AUDIO_URL }),
  });

  const data = await response.json();
  const alt = data?.results?.channels?.[0]?.alternatives?.[0];
  const words = alt?.words || [];

  // Verify all fields the Worker extracts are present.
  if (typeof alt.transcript !== 'string') throw new Error('transcript is not a string');
  if (typeof alt.confidence !== 'number') throw new Error('confidence is not a number');
  if (!Array.isArray(alt.words)) throw new Error('words is not an array');
  if (words.length > 0 && typeof words[words.length - 1].end !== 'number') {
    throw new Error('last word.end is not a number');
  }

  const duration = words.length > 0 ? words[words.length - 1].end : 0;
  console.log(`✓ Response structure valid`);
  console.log(`  confidence: ${alt.confidence.toFixed(3)}, duration: ${duration.toFixed(1)}s, words: ${words.length}`);
}

async function run() {
  await testRestApiUrlTranscription();
  await testResponseStructure();
}

run()
  .then(() => {
    console.log('\n✓ All tests passed');
    process.exit(0);
  })
  .catch(err => {
    console.error(`\n✗ Test failed: ${err.message}`);
    process.exit(1);
  });
