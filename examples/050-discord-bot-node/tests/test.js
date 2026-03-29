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

// We can't run the full Discord bot in CI (it needs a running bot connection
// and a real Discord server), but we CAN verify:
//   1. Deepgram API key works for STT (pre-recorded file transcription)
//   2. The bot module's syntax is valid and deps are installed

const { DeepgramClient } = require('@deepgram/sdk');

const KNOWN_AUDIO_URL = 'https://dpgr.am/spacewalk.wav';
const EXPECTED_WORDS = ['spacewalk', 'astronaut', 'nasa'];

async function testDeepgramSTT() {
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
    throw new Error(`Expected words not found in: "${transcript.substring(0, 200)}"`);
  }

  console.log(`✓ Transcript received (${transcript.length} chars)`);
  console.log(`✓ Expected content verified (found: ${found.join(', ')})`);
}

function testDiscordDepsInstalled() {
  // Verify discord.js is installed and importable — catches missing
  // npm install or incompatible Node.js version.
  console.log('Testing discord.js import...');
  const { Client, GatewayIntentBits } = require('discord.js');
  if (!Client || !GatewayIntentBits) {
    throw new Error('discord.js exports missing');
  }
  console.log('✓ discord.js loaded successfully');
}

async function run() {
  testDiscordDepsInstalled();
  await testDeepgramSTT();
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
