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

// SDK v5: DeepgramClient (class) replaces createClient() (function) from v3/v4.
const { DeepgramClient } = require('@deepgram/sdk');

const KNOWN_AUDIO_URL = 'https://dpgr.am/spacewalk.wav';
const EXPECTED_WORDS = ['spacewalk', 'astronaut', 'nasa'];

async function testPreRecordedSTT() {
  console.log('Testing Deepgram pre-recorded STT (nova-3)...');

  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  // SDK v5: flat single options object, throws on error.
  const data = await deepgram.listen.v1.media.transcribeUrl({
    url: KNOWN_AUDIO_URL,
    model: 'nova-3',
    smart_format: true,
  });

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

  console.log(`✓ Transcript received (${transcript.length} chars)`);
  console.log(`✓ Expected content verified (found: ${found.join(', ')})`);
  console.log(`  Preview: "${transcript.substring(0, 100)}..."`);
}

async function testLiveWebSocketConnection() {
  console.log('\nTesting Deepgram live WebSocket connection...');

  // Verify we can open a live STT WebSocket — this confirms the API key
  // has live transcription permissions and the endpoint is reachable.
  // We don't send audio (no microphone in CI), just verify the handshake.
  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  const connection = deepgram.listen.v1.live({
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: 16000,
    channels: 1,
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('WebSocket connection timed out after 10s'));
    }, 10000);

    connection.on('open', () => {
      clearTimeout(timeout);
      console.log('✓ Live WebSocket connection opened');
      // Close cleanly — send empty buffer to flush, then close.
      connection.finish();
      resolve();
    });

    connection.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${err.message || err}`));
    });
  });

  console.log('✓ Live WebSocket connection closed cleanly');
}

async function run() {
  await testPreRecordedSTT();
  await testLiveWebSocketConnection();
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
