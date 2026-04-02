'use strict';

const fs = require('fs');
const path = require('path');

// ── Credential check — MUST be first ──────────────────────────────────────
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
// ──────────────────────────────────────────────────────────────────────────

const { VapiClient } = require('@vapi-ai/server-sdk');
const { DeepgramClient } = require('@deepgram/sdk');

async function run() {
  // ── Test 1: Verify Deepgram API key works ─────────────────────────────
  console.log('Test 1: Verifying Deepgram API key...');
  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
  const data = await deepgram.listen.v1.media.transcribeUrl({
    url: 'https://dpgr.am/spacewalk.wav',
    model: 'nova-3',
    tag: 'deepgram-examples',
  });

  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (!transcript || transcript.length < 20) {
    throw new Error(`Deepgram transcript too short or empty: "${transcript}"`);
  }
  console.log(`  ✓ Deepgram STT working (${transcript.length} chars)`);

  // ── Test 2: Verify Vapi API key works by listing assistants ───────────
  console.log('Test 2: Verifying Vapi API key...');
  const vapi = new VapiClient({ token: process.env.VAPI_API_KEY });
  const assistants = await vapi.assistants.list();

  if (!Array.isArray(assistants)) {
    throw new Error('Expected assistants.list() to return an array');
  }
  console.log(`  ✓ Vapi API accessible (${assistants.length} assistant(s) found)`);

  // ── Test 3: Create a transient assistant with Deepgram STT/TTS ────────
  console.log('Test 3: Creating test assistant with Deepgram provider...');
  const assistant = await vapi.assistants.create({
    name: 'deepgram-examples-test-' + Date.now(),
    firstMessage: 'Hello, this is a test.',
    transcriber: {
      provider: 'deepgram',
      model: 'nova-3',
      language: 'en',
    },
    voice: {
      provider: 'deepgram',
      voiceId: 'aura-2-thalia-en',
    },
    model: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: 'You are a test assistant.' }],
    },
    maxDurationSeconds: 60,
  });

  if (!assistant.id) {
    throw new Error('Assistant creation did not return an ID');
  }
  console.log(`  ✓ Assistant created: ${assistant.id}`);

  // ── Cleanup: delete the test assistant ────────────────────────────────
  try {
    await vapi.assistants.delete(assistant.id);
    console.log(`  ✓ Test assistant deleted`);
  } catch (cleanupErr) {
    console.warn(`  ⚠ Could not delete test assistant: ${cleanupErr.message}`);
  }
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
