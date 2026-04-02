'use strict';

const fs = require('fs');
const path = require('path');

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

const { DeepgramClient } = require('@deepgram/sdk');

const KNOWN_AUDIO_URL = 'https://dpgr.am/spacewalk.wav';
const EXPECTED_WORDS = ['spacewalk', 'astronaut', 'nasa'];

async function testPreRecordedSTT() {
  console.log('Testing Deepgram pre-recorded STT (nova-3)...');

  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  const data = await deepgram.listen.v1.media.transcribeUrl({
    url: KNOWN_AUDIO_URL,
    model: 'nova-3',
    smart_format: true,
    tag: 'deepgram-examples',
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

  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  const connection = await deepgram.listen.v1.connect({
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: 16000,
    channels: 1,
    Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
    tag: 'deepgram-examples',
  });

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('WebSocket connection timed out after 10s'));
    }, 10000);

    connection.on('open', () => {
      clearTimeout(timeout);
      console.log('✓ Live WebSocket connection opened');
      connection.sendCloseStream({ type: 'CloseStream' });
      connection.close();
      resolve();
    });

    connection.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`WebSocket error: ${err.message || err}`));
    });

    connection.connect();
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
