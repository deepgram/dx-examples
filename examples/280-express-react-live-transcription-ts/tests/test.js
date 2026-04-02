'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const WebSocket = require('ws');

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

// Build the server before testing — the test imports the compiled JS
console.log('Building server...');
execSync('npm run build', {
  cwd: path.join(__dirname, '..', 'server'),
  stdio: 'pipe',
});

const { createApp } = require('../server/dist/server.js');

const PORT      = 3097;
const AUDIO_URL = 'https://dpgr.am/spacewalk.wav';
const TMP_WAV   = '/tmp/express_react_test.wav';

function downloadAudio() {
  console.log('Downloading test audio...');
  execSync(`curl -s -L -o "${TMP_WAV}" "${AUDIO_URL}"`, { stdio: 'pipe' });
  return fs.readFileSync(TMP_WAV);
}

function wavToLinear16_16k(wavBuffer) {
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
  const ratio = sampleRate / 16000;
  const outLen = Math.floor(totalSamples / ratio);
  const out = Buffer.alloc(outLen * 2);

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
    out.writeInt16LE(sample, i * 2);
  }
  return out;
}

// ── Test 1: Health endpoint ─────────────────────────────────────────────────
function testHealthEndpoint(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/health`, (res) => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`/health returned ${res.statusCode}`));
        const data = JSON.parse(body);
        if (data.status !== 'ok') return reject(new Error(`Unexpected health status: ${body}`));
        console.log('  /health -> ok');
        resolve();
      });
    }).on('error', reject);
  });
}

// ── Test 2: WebSocket transcription pipeline ────────────────────────────────
function testWebSocketTranscription(port, audioData) {
  return new Promise((resolve, reject) => {
    const transcripts = [];
    const CHUNK_SIZE = 3200;

    const timeout = setTimeout(() => {
      reject(new Error(
        'Timed out (60s) waiting for Deepgram transcript.\n' +
        'Check DEEPGRAM_API_KEY and connectivity to api.deepgram.com.',
      ));
    }, 60_000);

    const ws = new WebSocket(`ws://localhost:${port}/listen`);

    ws.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw);
        const text = data?.channel?.alternatives?.[0]?.transcript;
        if (text) {
          const tag = data.is_final ? 'final' : 'interim';
          transcripts.push({ tag, text });
        }
      } catch {}
    });

    ws.on('open', () => {
      let offset = 0;
      const MAX_BYTES = 16000 * 2 * 30;
      let settled = false;
      let doneSending = false;

      const settle = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        try { ws.close(); } catch {}
        if (transcripts.length === 0) {
          reject(new Error(
            'No transcripts received from Deepgram after streaming audio.\n' +
            'This may indicate a connection issue or audio encoding problem.',
          ));
        } else {
          resolve(transcripts);
        }
      };

      const sendChunk = () => {
        if (ws.readyState !== WebSocket.OPEN) return;

        if (offset >= audioData.length || offset >= MAX_BYTES) {
          doneSending = true;
          if (transcripts.length > 0) {
            setTimeout(settle, 1000);
          }
          return;
        }

        ws.send(audioData.subarray(offset, offset + CHUNK_SIZE));
        offset += CHUNK_SIZE;
        setTimeout(sendChunk, 20);
      };

      ws.on('message', () => {
        if (doneSending && transcripts.length > 0) {
          setTimeout(settle, 1000);
        }
      });

      setTimeout(sendChunk, 500);
    });

    ws.on('close', () => {
      setTimeout(() => {
        if (transcripts.length > 0) {
          clearTimeout(timeout);
          resolve(transcripts);
        }
      }, 1000);
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  const wavData = downloadAudio();
  console.log('Converting to linear16 16 kHz mono...');
  const audioData = wavToLinear16_16k(wavData);
  console.log(`Audio ready: ${audioData.length} bytes`);

  const app = createApp();
  const server = app.listen(PORT);
  await new Promise(r => server.on('listening', r));
  console.log(`\nServer started on :${PORT}`);

  try {
    await testHealthEndpoint(PORT);

    console.log('\nStreaming audio through WebSocket -> Deepgram (up to 60 s)...');
    const transcripts = await testWebSocketTranscription(PORT, audioData);

    console.log(`\nReceived ${transcripts.length} transcript event(s)`);
    console.log(`  First: [${transcripts[0].tag}] ${transcripts[0].text}`);

    const combined = transcripts.map(t => t.text).join(' ');
    const audioDurationSec = audioData.length / (16000 * 2);
    const charsPerSec = combined.length / Math.max(audioDurationSec, 1);

    if (combined.length < 10) {
      throw new Error(
        `Transcripts arrived but combined text too short (${combined.length} chars).\n` +
        `Got: ${transcripts.slice(0, 3).map(t => t.text).join(' | ')}`,
      );
    }
    console.log(`Transcript content verified (${combined.length} chars, ${charsPerSec.toFixed(1)} chars/sec over ${audioDurationSec.toFixed(1)}s audio)`);

  } finally {
    server.close();
  }
}

run()
  .then(() => { console.log('\nAll tests passed'); process.exit(0); })
  .catch(err => { console.error(`\nTest failed: ${err.message}`); process.exit(1); });
