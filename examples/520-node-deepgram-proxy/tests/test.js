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

const { createApp } = require('../src/server.js');

const PORT = 3098;
const AUDIO_URL = 'https://dpgr.am/spacewalk.wav';
const TMP_WAV = '/tmp/proxy_test.wav';

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

function httpPost(port, urlPath, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request({
      hostname: 'localhost',
      port,
      path: urlPath,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function httpGet(port, urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}${urlPath}`, (res) => {
      let buf = '';
      res.on('data', c => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(buf) }));
    }).on('error', reject);
  });
}

// ── Test 1: Health endpoint ──────────────────────────────────────────────
async function testHealth(port) {
  console.log('Test 1: GET /health');
  const { status, body } = await httpGet(port, '/health');
  if (status !== 200) throw new Error(`/health returned ${status}`);
  if (body.status !== 'ok') throw new Error(`Unexpected health status: ${JSON.stringify(body)}`);
  console.log('  /health -> ok');
}

// ── Test 2: Pre-recorded transcription via proxy ─────────────────────────
async function testPrerecorded(port) {
  console.log('Test 2: POST /v1/listen (pre-recorded)');
  const { status, body } = await httpPost(port, '/v1/listen', { url: AUDIO_URL, smart_format: true });
  if (status !== 200) throw new Error(`/v1/listen returned ${status}: ${JSON.stringify(body)}`);
  const transcript = body?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (!transcript || transcript.length < 66) {
    throw new Error(`Transcript too short (${transcript?.length ?? 0} chars, want >= 66)`);
  }
  console.log(`  Transcript: ${transcript.length} chars`);
  console.log(`  Preview: "${transcript.substring(0, 80)}..."`);
}

// ── Test 3: WebSocket live STT via proxy ─────────────────────────────────
function testWebSocket(port, audioData) {
  return new Promise((resolve, reject) => {
    console.log('Test 3: WS /v1/listen/stream (live STT)');
    const transcripts = [];
    const CHUNK_SIZE = 3200;

    const timeout = setTimeout(() => {
      reject(new Error('Timed out (60s) waiting for transcript via WS proxy'));
    }, 60_000);

    const ws = new WebSocket(`ws://localhost:${port}/v1/listen/stream`);

    ws.on('error', (err) => { clearTimeout(timeout); reject(err); });

    ws.on('message', (raw) => {
      try {
        const data = JSON.parse(raw);
        const text = data?.channel?.alternatives?.[0]?.transcript;
        if (text) {
          transcripts.push({ tag: data.is_final ? 'final' : 'interim', text });
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
          reject(new Error('No transcripts received via WS proxy'));
        } else {
          resolve(transcripts);
        }
      };

      const sendChunk = () => {
        if (ws.readyState !== WebSocket.OPEN) return;
        if (offset >= audioData.length || offset >= MAX_BYTES) {
          doneSending = true;
          if (transcripts.length > 0) setTimeout(settle, 1000);
          return;
        }
        ws.send(audioData.subarray(offset, offset + CHUNK_SIZE));
        offset += CHUNK_SIZE;
        setTimeout(sendChunk, 20);
      };

      ws.on('message', () => {
        if (doneSending && transcripts.length > 0) setTimeout(settle, 1000);
      });

      setTimeout(sendChunk, 500);
    });

    ws.on('close', () => {
      setTimeout(() => {
        if (transcripts.length > 0) { clearTimeout(timeout); resolve(transcripts); }
      }, 1000);
    });
  });
}

// ── Test 4: REST validation (missing URL) ────────────────────────────────
async function testValidation(port) {
  console.log('Test 4: POST /v1/listen without url (validation)');
  const { status, body } = await httpPost(port, '/v1/listen', {});
  if (status !== 400) throw new Error(`Expected 400 for missing url, got ${status}`);
  if (!body.error) throw new Error('Expected error message for missing url');
  console.log(`  Validation -> ${body.error}`);
}

// ── Main ─────────────────────────────────────────────────────────────────
async function run() {
  const wavData = downloadAudio();
  console.log('Converting to linear16 16 kHz mono...');
  const audioData = wavToLinear16_16k(wavData);
  console.log(`Audio ready: ${audioData.length} bytes`);

  const app = createApp();
  const server = app.listen(PORT);
  await new Promise(r => server.on('listening', r));
  console.log(`\nProxy server started on :${PORT}\n`);

  try {
    await testHealth(PORT);
    await testValidation(PORT);
    await testPrerecorded(PORT);

    console.log('\nStreaming audio through WS proxy -> Deepgram (up to 60s)...');
    const transcripts = await testWebSocket(PORT, audioData);
    console.log(`  Received ${transcripts.length} transcript event(s)`);
    console.log(`  First: [${transcripts[0].tag}] ${transcripts[0].text}`);

    const combined = transcripts.map(t => t.text).join(' ');
    const audioDurationSec = audioData.length / (16000 * 2);
    if (combined.length < 10) {
      throw new Error(`Combined transcript too short (${combined.length} chars)`);
    }
    console.log(`  Content verified (${combined.length} chars over ${audioDurationSec.toFixed(1)}s audio)`);
  } finally {
    server.close();
  }
}

run()
  .then(() => { console.log('\n\u2713 All tests passed'); process.exit(0); })
  .catch(err => { console.error(`\n\u2717 Test failed: ${err.message}`); process.exit(1); });
