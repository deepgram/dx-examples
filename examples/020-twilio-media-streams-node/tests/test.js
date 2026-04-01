'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const WebSocket = require('ws');

// ── Credential check ─────────────────────────────────────────────────────────
// Must run FIRST, before any imports that depend on env vars.
// Exit 2 = missing credentials (expected in CI), not a code bug.
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

const { createApp } = require('../src/index.js');

const PORT       = 3099;
const AUDIO_URL  = 'https://dpgr.am/spacewalk.wav';
const TMP_WAV    = '/tmp/twilio_test.wav';
const CHUNK_SIZE = 320;

const LINEAR_TO_ULAW = (() => {
  const BIAS = 0x84;
  const CLIP = 32635;
  const table = new Int8Array(65536);
  for (let i = -32768; i < 32768; i++) {
    let sample = i < 0 ? ~i : i;
    if (sample > CLIP) sample = CLIP;
    sample += BIAS;
    let exponent = 7;
    for (let expMask = 0x4000; (sample & expMask) === 0 && exponent > 0; exponent--, expMask >>= 1);
    const mantissa = (sample >> (exponent + 3)) & 0x0F;
    let ulawByte = ~(((i < 0 ? 0x80 : 0) | (exponent << 4) | mantissa)) & 0xFF;
    table[i & 0xFFFF] = ulawByte;
  }
  return table;
})();

function wavToMulaw8k(wavBuffer) {
  let offset = 12;
  let sampleRate = 0, bitsPerSample = 0, numChannels = 0, dataStart = 0, dataSize = 0;
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
  const ratio = sampleRate / 8000;
  const outLen = Math.floor(totalSamples / ratio);
  const out = Buffer.alloc(outLen);

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
    out[i] = LINEAR_TO_ULAW[sample & 0xFFFF];
  }
  return out;
}

function prepareMulawAudio() {
  console.log('Downloading test audio...');
  execSync(`curl -s -L -o "${TMP_WAV}" "${AUDIO_URL}"`, { stdio: 'pipe' });

  console.log('Converting to μ-law 8 kHz mono...');
  const wavData = fs.readFileSync(TMP_WAV);
  const audio = wavToMulaw8k(wavData);
  console.log(`✓ Audio ready: ${audio.length} bytes of μ-law 8 kHz`);
  return audio;
}

// ── Test 1: TwiML endpoint ────────────────────────────────────────────────────
// POST /voice should return TwiML containing a <Stream> pointing at /media.
// This is what Twilio calls when the phone rings.
function testTwimlEndpoint(port) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: 'localhost', port, path: '/voice', method: 'POST',
        headers: { host: `localhost:${port}`, 'content-type': 'application/x-www-form-urlencoded' },
      },
      (res) => {
        let body = '';
        res.on('data', c => (body += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`/voice returned ${res.statusCode}`));
          if (!body.includes('<Stream'))
            return reject(new Error(`TwiML missing <Stream> element:\n${body}`));
          if (!body.includes(`localhost:${port}/media`))
            return reject(new Error(`TwiML <Stream> URL should point to /media:\n${body}`));
          console.log('✓ POST /voice → TwiML with correct <Stream url=".../media">');
          resolve();
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ── Test 2: Full WebSocket + Deepgram pipeline ────────────────────────────────
// Connects to /media acting as Twilio, sends real mulaw audio in Twilio's exact
// message format, and verifies Deepgram returns recognisable transcript text.
//
// We intercept console.log while the server is running to capture transcript
// events — the server prints "[final] <text>" for each Deepgram result.
function testMediaStreamFlow(port, audioData) {
  return new Promise((resolve, reject) => {
    const transcripts = [];

    // Intercept server console output to capture transcript lines
    const origLog = console.log;
    console.log = (...args) => {
      origLog(...args);
      const line = args.join(' ');
      if (line.startsWith('[final]') || line.startsWith('[interim]')) {
        transcripts.push(line);
      }
    };

    const cleanup = (fn) => { console.log = origLog; fn(); };

    const timeout = setTimeout(() => {
      cleanup(() => reject(new Error(
        'Timed out (30s) waiting for Deepgram transcript.\n' +
        'Check DEEPGRAM_API_KEY and connectivity to api.deepgram.com.',
      )));
    }, 30_000);

    const ws = new WebSocket(`ws://localhost:${port}/media`);

    ws.on('error', (err) => {
      clearTimeout(timeout);
      cleanup(() => reject(err));
    });

    ws.on('open', () => {
      // Twilio sends these three event types in order for every call

      // 1. "connected" — WebSocket handshake confirmation
      ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));

      // 2. "start" — stream metadata (account/call SIDs, media format)
      ws.send(JSON.stringify({
        event: 'start',
        streamSid: 'MZ_ci_test',
        start: {
          streamSid: 'MZ_ci_test',
          accountSid: process.env.TWILIO_ACCOUNT_SID,
          callSid: 'CA_ci_test',
          mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
        },
      }));

      // 3. "media" — one message per 20 ms frame of base64-encoded μ-law audio
      // Throttled to real-time so Deepgram receives a natural audio stream.
      // We cap at 5 seconds to keep the test fast.
      let offset = 0;
      const MAX_BYTES = 8000 * 5; // 5 seconds at 8 kHz

      const sendChunk = () => {
        if (ws.readyState !== WebSocket.OPEN) return;

        if (offset >= audioData.length || offset >= MAX_BYTES) {
          ws.send(JSON.stringify({ event: 'stop', streamSid: 'MZ_ci_test' }));
          setTimeout(() => ws.close(), 500);
          return;
        }

        ws.send(JSON.stringify({
          event: 'media',
          streamSid: 'MZ_ci_test',
          media: {
            track: 'inbound',
            chunk: String(Math.floor(offset / CHUNK_SIZE)),
            payload: audioData.subarray(offset, offset + CHUNK_SIZE).toString('base64'),
          },
        }));

        offset += CHUNK_SIZE;
        setTimeout(sendChunk, 20); // 20 ms real-time pacing
      };

      // Give the Deepgram WebSocket inside the server a moment to open
      setTimeout(sendChunk, 500);
    });

    ws.on('close', () => {
      // Wait for any final Deepgram messages to arrive after stop
      setTimeout(() => {
        clearTimeout(timeout);
        cleanup(() => {
          if (transcripts.length === 0) {
            reject(new Error(
              'No transcripts received from Deepgram after streaming 5 s of audio.\n' +
              'This may indicate a Deepgram connection issue or audio encoding problem.',
            ));
          } else {
            resolve(transcripts);
          }
        });
      }, 2000);
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  const audioData = prepareMulawAudio();

  const app = createApp();
  const server = app.listen(PORT);
  await new Promise(r => server.on('listening', r));
  console.log(`\n✓ Server started on :${PORT}`);

  try {
    await testTwimlEndpoint(PORT);

    console.log('\nStreaming audio through server → Deepgram (up to 30 s)...');
    const transcripts = await testMediaStreamFlow(PORT, audioData);

    console.log(`\n✓ Received ${transcripts.length} transcript event(s)`);
    console.log(`  First: ${transcripts[0]}`);

    // Verify recognisable words from the spacewalk recording
    const combined = transcripts.join(' ').toLowerCase();
    const expectedWords = ['spacewalk', 'astronaut', 'nasa'];
    const found = expectedWords.filter(w => combined.includes(w));

    if (found.length === 0) {
      throw new Error(
        `Transcripts arrived but no expected words found.\n` +
        `Got: ${transcripts.slice(0, 3).join(' | ')}`,
      );
    }
    console.log(`✓ Transcript content verified (found: ${found.join(', ')})`);

  } finally {
    server.close();
  }
}

run()
  .then(() => { console.log('\n✓ All tests passed'); process.exit(0); })
  .catch(err => { console.error(`\n✗ Test failed: ${err.message}`); process.exit(1); });
