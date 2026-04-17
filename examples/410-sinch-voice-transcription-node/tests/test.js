'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');
const WebSocket = require('ws');

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

const { createApp } = require('../src/index.js');

const PORT = 3098;
const AUDIO_URL = 'https://dpgr.am/spacewalk.wav';
const TMP_WAV = '/tmp/sinch_test.wav';
const CHUNK_SIZE = 640;

function wavToLinear16(wavBuffer, targetRate) {
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
  const ratio = sampleRate / targetRate;
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
    out.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
  }
  return out;
}

function prepareAudio() {
  console.log('Downloading test audio...');
  execSync(`curl -s -L -o "${TMP_WAV}" "${AUDIO_URL}"`, { stdio: 'pipe' });

  console.log('Converting to linear16 16 kHz mono...');
  const wavData = fs.readFileSync(TMP_WAV);
  const audio = wavToLinear16(wavData, 16000);
  console.log(`Audio ready: ${audio.length} bytes of linear16 16 kHz`);
  return audio;
}

// ── Test 1: ICE endpoint returns valid SVAML ─────────────────────────────────
function testIceEndpoint(port) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ event: 'ice', callid: 'test-call-123' });
    const req = http.request(
      {
        hostname: 'localhost', port, path: '/sinch/ice', method: 'POST',
        headers: {
          host: `localhost:${port}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`/sinch/ice returned ${res.statusCode}`));
          let svaml;
          try { svaml = JSON.parse(data); } catch (e) { return reject(e); }

          if (!svaml.instructions || !Array.isArray(svaml.instructions)) {
            return reject(new Error('SVAML must include instructions array'));
          }

          const answerInstr = svaml.instructions.find(i => i.name === 'answer');
          if (!answerInstr) {
            return reject(new Error('SVAML instructions must include "answer"'));
          }

          const sayInstr = svaml.instructions.find(i => i.name === 'say');
          if (!sayInstr || !sayInstr.text) {
            return reject(new Error('SVAML instructions must include "say" with text'));
          }

          if (!svaml.action || svaml.action.name !== 'connectStream') {
            return reject(new Error('SVAML action must be "connectStream"'));
          }

          if (!svaml.action.destination || svaml.action.destination.type !== 'websocket') {
            return reject(new Error('connectStream destination must be websocket type'));
          }

          if (!svaml.action.destination.endpoint || !svaml.action.destination.endpoint.includes('/stream')) {
            return reject(new Error(`connectStream endpoint must point to /stream, got: ${svaml.action.destination.endpoint}`));
          }

          if (!svaml.action.streamingOptions || svaml.action.streamingOptions.sampleRate !== 16000) {
            return reject(new Error('streamingOptions must set sampleRate to 16000'));
          }

          console.log('POST /sinch/ice → valid SVAML with connectStream');
          console.log(`  destination: ${svaml.action.destination.endpoint}`);
          console.log(`  sampleRate: ${svaml.action.streamingOptions.sampleRate}`);
          resolve(svaml);
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

// ── Test 2: ACE endpoint ─────────────────────────────────────────────────────
function testAceEndpoint(port) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ event: 'ace', callid: 'test-call-123' });
    const req = http.request(
      {
        hostname: 'localhost', port, path: '/sinch/ace', method: 'POST',
        headers: {
          host: `localhost:${port}`,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body),
        },
      },
      (res) => {
        let data = '';
        res.on('data', c => (data += c));
        res.on('end', () => {
          if (res.statusCode !== 200) return reject(new Error(`/sinch/ace returned ${res.statusCode}`));
          let resp;
          try { resp = JSON.parse(data); } catch (e) { return reject(e); }
          if (!resp.action || resp.action.name !== 'continue') {
            return reject(new Error('ACE response must have action "continue"'));
          }
          console.log('POST /sinch/ace → valid response with continue action');
          resolve();
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}

// ── Test 3: Health check ─────────────────────────────────────────────────────
function testHealthCheck(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://127.0.0.1:${port}/`, (res) => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`Health check returned ${res.statusCode}`));
        let data;
        try { data = JSON.parse(body); } catch (e) { return reject(e); }
        if (data.status !== 'ok') {
          return reject(new Error(`Health check must return {status: "ok"}, got: ${JSON.stringify(data)}`));
        }
        console.log('GET / → {status: "ok"}');
        resolve();
      });
    }).on('error', reject);
  });
}

// ── Test 4: Full WebSocket + Deepgram pipeline ──────────────────────────────
// Connects to /stream acting as Sinch, sends real linear16 audio in Sinch's
// format, and verifies Deepgram returns transcript text.
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
      // Sinch sends an initial JSON text message with metadata and call headers,
      // then binary audio frames.
      ws.send(JSON.stringify({
        event: 'stream-start',
        callHeaders: [{ key: 'call-id', value: 'ci-test-call' }],
        contentType: 'audio/l16;rate=16000',
      }));

      let offset = 0;
      const MAX_BYTES = 16000 * 2 * 10; // 10 seconds of 16 kHz 16-bit mono

      const sendChunk = () => {
        if (ws.readyState !== WebSocket.OPEN) return;

        if (offset >= audioData.length || offset >= MAX_BYTES) {
          setTimeout(() => {
            try { ws.close(); } catch {}
            setTimeout(settle, 2000);
          }, 500);
          return;
        }

        ws.send(audioData.subarray(offset, offset + CHUNK_SIZE));
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

// ── Main ────────────────────────────────────────────────────────────────────
async function run() {
  const audioData = prepareAudio();

  const app = createApp();
  const server = app.listen(PORT);
  await new Promise(r => server.on('listening', r));
  console.log(`\nServer started on :${PORT}`);

  try {
    await testIceEndpoint(PORT);
    await testAceEndpoint(PORT);
    await testHealthCheck(PORT);

    console.log('\nStreaming audio through server → Deepgram (up to 30 s)...');
    const transcripts = await testStreamFlow(PORT, audioData);

    console.log(`\nReceived ${transcripts.length} transcript event(s)`);
    console.log(`  First: ${transcripts[0]}`);

    const combined = transcripts.join(' ').toLowerCase();
    const bytesSent = Math.min(audioData.length, 16000 * 2 * 10);
    const audioSentSecs = bytesSent / (16000 * 2);
    const minChars = Math.max(5, audioSentSecs * 2);
    if (combined.length < minChars) {
      throw new Error(
        `Transcript too short: ${combined.length} chars for ${audioSentSecs}s of audio (expected >= ${minChars})`,
      );
    }
    console.log(`Transcript length verified: ${combined.length} chars for ${audioSentSecs.toFixed(1)}s audio`);

  } finally {
    server.close();
  }
}

run()
  .then(() => { console.log('\nAll tests passed'); process.exit(0); })
  .catch(err => { console.error(`\nTest failed: ${err.message}`); process.exit(1); });
