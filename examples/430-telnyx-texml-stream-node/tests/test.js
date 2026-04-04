'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const WebSocket = require('ws');

// ── Credential check — MUST be first ──────────────────────────────────────
// Only DEEPGRAM_API_KEY is needed for the test pipeline; TELNYX_API_KEY is
// used for portal configuration but not at runtime by this server.
if (!process.env.DEEPGRAM_API_KEY) {
  console.error('MISSING_CREDENTIALS: DEEPGRAM_API_KEY');
  process.exit(2);
}
// ──────────────────────────────────────────────────────────────────────────

const { createApp } = require('../src/index.js');

const PORT       = 3099;
const AUDIO_URL  = 'https://dpgr.am/spacewalk.wav';
const TMP_WAV    = '/tmp/telnyx_test.wav';
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

  console.log('Converting to mulaw 8 kHz mono...');
  const wavData = fs.readFileSync(TMP_WAV);
  const audio = wavToMulaw8k(wavData);
  console.log(`Audio ready: ${audio.length} bytes of mulaw 8 kHz`);
  return audio;
}

// ── Test 1: TeXML endpoint ──────────────────────────────────────────────────
// POST /voice should return TeXML containing a <Stream> pointing at /stream.
function testTexmlEndpoint(port) {
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
            return reject(new Error(`TeXML missing <Stream> element:\n${body}`));
          if (!body.includes(`localhost:${port}/stream`))
            return reject(new Error(`TeXML <Stream> URL should point to /stream:\n${body}`));
          if (!body.includes('track="inbound_track"'))
            return reject(new Error(`TeXML <Stream> missing track attribute:\n${body}`));
          console.log('PASS: POST /voice returns TeXML with correct <Stream url=".../stream">');
          resolve();
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

// ── Test 2: Full WebSocket + Deepgram pipeline ────────────────────────────
// Simulates Telnyx by connecting to /stream and sending audio in the exact
// Telnyx Stream message format, then verifies Deepgram returns transcript text.
function testStreamFlow(port, audioData) {
  return new Promise((resolve, reject) => {
    const transcripts = [];

    const origLog = console.log;
    console.log = (...args) => {
      origLog(...args);
      const line = args.join(' ');
      if (line.startsWith('[final]') || line.startsWith('[interim]')) {
        transcripts.push(line);
      }
    };

    const cleanup = (fn) => { console.log = origLog; fn(); };

    let settled = false;

    const timeout = setTimeout(() => {
      cleanup(() => reject(new Error(
        'Timed out (30s) waiting for Deepgram transcript.\n' +
        'Check DEEPGRAM_API_KEY and connectivity to api.deepgram.com.',
      )));
    }, 30_000);

    const settle = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup(() => {
        if (transcripts.length === 0) {
          reject(new Error(
            'No transcripts received from Deepgram after streaming audio.\n' +
            'This may indicate a Deepgram connection issue or audio encoding problem.',
          ));
        } else {
          resolve(transcripts);
        }
      });
    };

    const ws = new WebSocket(`ws://localhost:${port}/stream`);

    ws.on('error', (err) => {
      clearTimeout(timeout);
      cleanup(() => reject(err));
    });

    ws.on('open', () => {
      // Telnyx sends the same event sequence as Twilio Media Streams

      ws.send(JSON.stringify({ event: 'connected', protocol: 'Call', version: '1.0.0' }));

      ws.send(JSON.stringify({
        event: 'start',
        streamSid: 'TX_ci_test',
        start: {
          streamSid: 'TX_ci_test',
          callControlId: 'v3:ci_test_call',
          mediaFormat: { encoding: 'audio/x-mulaw', sampleRate: 8000, channels: 1 },
        },
      }));

      let offset = 0;
      const MAX_BYTES = 8000 * 10;

      const sendChunk = () => {
        if (ws.readyState !== WebSocket.OPEN) return;

        if (offset >= audioData.length || offset >= MAX_BYTES) {
          ws.send(JSON.stringify({ event: 'stop', streamSid: 'TX_ci_test' }));
          setTimeout(() => {
            try { ws.close(); } catch {}
            setTimeout(settle, 2000);
          }, 500);
          return;
        }

        ws.send(JSON.stringify({
          event: 'media',
          streamSid: 'TX_ci_test',
          media: {
            track: 'inbound',
            chunk: String(Math.floor(offset / CHUNK_SIZE)),
            payload: audioData.subarray(offset, offset + CHUNK_SIZE).toString('base64'),
          },
        }));

        offset += CHUNK_SIZE;
        setTimeout(sendChunk, 20);
      };

      setTimeout(sendChunk, 500);
    });

    ws.on('close', () => {
      setTimeout(settle, 2000);
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  const audioData = prepareMulawAudio();

  const app = createApp();
  const server = app.listen(PORT);
  await new Promise(r => server.on('listening', r));
  console.log(`\nServer started on :${PORT}`);

  try {
    await testTexmlEndpoint(PORT);

    console.log('\nStreaming audio through server to Deepgram (up to 30 s)...');
    const transcripts = await testStreamFlow(PORT, audioData);

    console.log(`\nPASS: Received ${transcripts.length} transcript event(s)`);
    console.log(`  First: ${transcripts[0]}`);

    const combined = transcripts.join(' ').toLowerCase();
    const audioSentSecs = Math.min(audioData.length, 8000 * 10) / 8000;
    const minChars = Math.max(5, audioSentSecs * 2);
    const totalChars = combined.replace(/\[(final|interim)\]\s*/g, '').trim().length;

    if (totalChars < minChars) {
      throw new Error(
        `Transcript too short: ${totalChars} chars for ${audioSentSecs}s of audio (expected >= ${minChars})`,
      );
    }
    console.log(`PASS: Transcript length (${totalChars} chars) proportional to ${audioSentSecs}s of audio`);

  } finally {
    server.close();
  }
}

run()
  .then(() => { console.log('\nAll tests passed'); process.exit(0); })
  .catch(err => { console.error(`\nTest failed: ${err.message}`); process.exit(1); });
