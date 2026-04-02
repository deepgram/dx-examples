'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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

const AUDIO_URL = 'https://dpgr.am/spacewalk.wav';
const TMP_WAV = '/tmp/nuxt_test.wav';

// ── Test 1: File structure ───────────────────────────────────────────────
function testFileStructure() {
  const root = path.join(__dirname, '..');
  const requiredFiles = [
    'package.json',
    'nuxt.config.ts',
    'app.vue',
    'pages/index.vue',
    'server/routes/api/listen.ts',
    'server/routes/api/speak.post.ts',
  ];

  for (const f of requiredFiles) {
    const full = path.join(root, f);
    if (!fs.existsSync(full)) throw new Error(`Missing required file: ${f}`);
  }
  console.log('File structure check passed');
}

// ── Test 2: Deepgram STT via live WebSocket ──────────────────────────────
async function testDeepgramSTT() {
  const { DeepgramClient } = require('@deepgram/sdk');
  const client = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  console.log('Downloading test audio...');
  execSync(`curl -s -L -o "${TMP_WAV}" "${AUDIO_URL}"`, { stdio: 'pipe' });

  const wavBuffer = fs.readFileSync(TMP_WAV);

  let offset = 12;
  let dataStart = 0, dataSize = 0, sampleRate = 0, bitsPerSample = 0, numChannels = 0;
  while (offset < wavBuffer.length - 8) {
    const chunkId = wavBuffer.toString('ascii', offset, offset + 4);
    const chunkSize = wavBuffer.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      numChannels = wavBuffer.readUInt16LE(offset + 10);
      sampleRate = wavBuffer.readUInt32LE(offset + 12);
      bitsPerSample = wavBuffer.readUInt16LE(offset + 22);
    } else if (chunkId === 'data') {
      dataStart = offset + 8;
      dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize;
  }
  if (!dataStart) throw new Error('Invalid WAV: no data chunk');

  const bytesPerSample = bitsPerSample / 8;
  const totalSamples = Math.floor(dataSize / (bytesPerSample * numChannels));
  const ratio = sampleRate / 16000;
  const outLen = Math.floor(totalSamples / ratio);
  const pcm16 = Buffer.alloc(outLen * 2);

  for (let i = 0; i < outLen; i++) {
    const srcIdx = Math.floor(i * ratio);
    const byteOff = dataStart + srcIdx * bytesPerSample * numChannels;
    let sample;
    if (bitsPerSample === 16) {
      sample = wavBuffer.readInt16LE(byteOff);
    } else if (bitsPerSample === 24) {
      sample = (wavBuffer[byteOff] | (wavBuffer[byteOff + 1] << 8) | (wavBuffer[byteOff + 2] << 16));
      if (sample & 0x800000) sample |= ~0xFFFFFF;
      sample = sample >> 8;
    } else if (bitsPerSample === 32) {
      sample = wavBuffer.readInt32LE(byteOff) >> 16;
    } else {
      sample = (wavBuffer[byteOff] - 128) << 8;
    }
    pcm16.writeInt16LE(sample, i * 2);
  }

  console.log(`Audio ready: ${pcm16.length} bytes of linear16 16 kHz`);

  const connection = await client.listen.v1.connect({
    model: 'nova-3',
    encoding: 'linear16',
    sample_rate: 16000,
    channels: 1,
    smart_format: true,
    interim_results: true,
    utterance_end_ms: 1500,
    tag: 'deepgram-examples',
  });

  const MAX_BYTES = 16000 * 2 * 15;
  const transcripts = [];

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('Timed out (30s) waiting for Deepgram transcript.'));
    }, 30_000);

    connection.on('error', (err) => {
      clearTimeout(timeout);
      reject(new Error(`Deepgram connection error: ${err.message}`));
    });

    connection.on('message', (data) => {
      try {
        const transcript = data?.channel?.alternatives?.[0]?.transcript;
        if (transcript) {
          const tag = data.is_final ? 'final' : 'interim';
          console.log(`[${tag}] ${transcript}`);
          transcripts.push(transcript);
        }
      } catch {}
    });

    connection.on('close', () => {
      clearTimeout(timeout);
      setTimeout(() => {
        if (transcripts.length === 0) {
          reject(new Error('No transcripts received from Deepgram.'));
          return;
        }

        const combined = transcripts.join(' ');
        const streamedSeconds = MAX_BYTES / (16000 * 2);
        const minChars = streamedSeconds * 2;

        if (combined.length < minChars) {
          reject(new Error(
            `Transcript too short for ${streamedSeconds}s of audio: ${combined.length} chars (min ${minChars}).\nGot: ${transcripts.slice(0, 3).join(' | ')}`
          ));
          return;
        }

        console.log(`\nSTT verified: ${combined.length} chars from ${streamedSeconds}s of audio`);
        resolve(transcripts);
      }, 1000);
    });

    connection.connect();
    connection.waitForOpen().then(() => {
      console.log('[deepgram] Connected — streaming audio...');

      const CHUNK_BYTES = 640;
      let pos = 0;

      const sendChunk = () => {
        if (pos >= pcm16.length || pos >= MAX_BYTES) {
          console.log('[deepgram] Audio sent — waiting for final results...');
          try { connection.sendCloseStream({ type: 'CloseStream' }); } catch {}
          try { connection.close(); } catch {}
          return;
        }
        connection.sendBinary(pcm16.subarray(pos, pos + CHUNK_BYTES));
        pos += CHUNK_BYTES;
        setTimeout(sendChunk, 20);
      };

      sendChunk();
    }).catch(reject);
  });
}

// ── Test 3: Deepgram TTS ─────────────────────────────────────────────────
async function testDeepgramTTS() {
  const { DeepgramClient } = require('@deepgram/sdk');
  const client = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  console.log('Testing Deepgram TTS...');
  const response = await client.speak.v1.audio.generate({
    text: 'Hello from the Nuxt Deepgram example test.',
    model: 'aura-2-thalia-en',
    encoding: 'linear16',
    sample_rate: 24000,
    tag: 'deepgram-examples',
  });

  const audioBuffer = await response.arrayBuffer();
  const size = audioBuffer.byteLength;

  if (size < 1000) {
    throw new Error(`TTS audio too small: ${size} bytes`);
  }

  console.log(`TTS verified: ${size} bytes of audio received`);
}

// ── Main ──────────────────────────────────────────────────────────────────
async function run() {
  testFileStructure();
  await testDeepgramSTT();
  await testDeepgramTTS();
}

run()
  .then(() => { console.log('\nAll tests passed'); process.exit(0); })
  .catch(err => { console.error(`\nTest failed: ${err.message}`); process.exit(1); });
