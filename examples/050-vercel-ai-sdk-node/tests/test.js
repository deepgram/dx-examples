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

const { deepgram } = require('@ai-sdk/deepgram');
const {
  experimental_transcribe: transcribe,
  experimental_generateSpeech: generateSpeech,
} = require('ai');

const KNOWN_AUDIO_URL = 'https://dpgr.am/spacewalk.wav';
const EXPECTED_WORDS = ['spacewalk', 'astronaut', 'nasa'];

async function run() {
  // ── Test 1: Transcription via AI SDK ────────────────────────────────────
  console.log('Testing Deepgram transcription via Vercel AI SDK...');

  const transcript = await transcribe({
    model: deepgram.transcription('nova-3'),
    audio: new URL(KNOWN_AUDIO_URL),
    providerOptions: {
      deepgram: {
        smart_format: true,
      },
    },
  });

  if (!transcript.text || transcript.text.length < 20) {
    throw new Error(`Transcript too short or empty: "${transcript.text}"`);
  }

  const lower = transcript.text.toLowerCase();
  const found = EXPECTED_WORDS.filter(w => lower.includes(w));
  if (found.length === 0) {
    throw new Error(
      `Expected words not found in transcript.\nGot: "${transcript.text.substring(0, 200)}"`
    );
  }

  console.log(`✓ Transcription working (${transcript.text.length} chars)`);
  console.log(`✓ Expected content verified (found: ${found.join(', ')})`);
  console.log(`  Preview: "${transcript.text.substring(0, 100)}..."`);

  // ── Test 2: Text-to-Speech via AI SDK ───────────────────────────────────
  console.log('\nTesting Deepgram TTS via Vercel AI SDK...');

  const speech = await generateSpeech({
    model: deepgram.speech('aura-2-helena-en'),
    text: 'Hello from the Vercel AI SDK test suite.',
    providerOptions: {
      deepgram: {
        encoding: 'linear16',
        sample_rate: 24000,
      },
    },
  });

  // linear16 at 24 kHz for a short sentence should produce at least a few KB.
  // If we get fewer than 1000 bytes, the TTS call likely returned silence or an error.
  if (!speech.audio?.uint8Array || speech.audio.uint8Array.length < 1000) {
    throw new Error(`TTS audio too small: ${speech.audio?.uint8Array?.length || 0} bytes`);
  }

  console.log(`✓ TTS working (${speech.audio.uint8Array.length} bytes)`);
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
