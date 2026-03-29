'use strict';

const fs = require('fs');
const path = require('path');

// ── Credential check ─────────────────────────────────────────────────────────
// Exit code convention:
//   0 = all tests passed
//   1 = real test failure
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

const { DeepgramClient } = require('@deepgram/sdk');

async function run() {
  // We can't test the full Vonage→Deepgram pipeline without a real phone call,
  // but we CAN verify the Deepgram SDK is configured correctly and the API key
  // has STT permissions.
  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  console.log('Testing Deepgram STT integration (nova-3)...');

  const data = await deepgram.listen.v1.media.transcribeUrl({
    url: 'https://dpgr.am/spacewalk.wav',
    model: 'nova-3',
    smart_format: true,
  });

  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (!transcript || transcript.length < 10) throw new Error('Transcript too short');

  console.log('✓ Deepgram STT integration working');
  console.log(`  Transcript preview: "${transcript.substring(0, 80)}..."`);

  // Verify express app loads without errors.
  const { createApp } = require('../src/index.js');
  if (typeof createApp !== 'function') throw new Error('createApp not exported');
  console.log('✓ Express app module loads correctly');
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
