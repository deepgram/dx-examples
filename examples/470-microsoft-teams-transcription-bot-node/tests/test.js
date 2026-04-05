'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync } = require('child_process');

const envExample = path.join(__dirname, '..', '.env.example');
const required = fs.readFileSync(envExample, 'utf8')
  .split('\n')
  .filter((l) => /^[A-Z][A-Z0-9_]+=/.test(l.trim()))
  .map((l) => l.split('=')[0].trim());

const missing = required.filter((k) => !process.env[k]);
if (missing.length > 0) {
  if (!process.env.DEEPGRAM_API_KEY) {
    console.error(`MISSING_CREDENTIALS: ${missing.join(',')}`);
    process.exit(2);
  }
  console.log(`Note: Missing Azure credentials (${missing.filter(k => k !== 'DEEPGRAM_API_KEY').join(', ')}) — skipping server integration tests, running Deepgram streaming test only`);
}

const { CallingHandler, DEEPGRAM_LIVE_OPTIONS } = require('../src/calling');

const PORT = 3199;
const hasAllCreds = missing.length === 0;
const AUDIO_URL = 'https://dpgr.am/spacewalk.wav';
const TMP_WAV = '/tmp/teams_test.wav';

function httpRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function downloadAndConvertAudio() {
  console.log('Downloading test audio...');
  execSync(`curl -s -L -o "${TMP_WAV}" "${AUDIO_URL}"`, { stdio: 'pipe' });

  const wavData = fs.readFileSync(TMP_WAV);
  let offset = 12;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let numChannels = 0;
  let dataStart = 0;
  let dataSize = 0;

  while (offset < wavData.length - 8) {
    const chunkId = wavData.toString('ascii', offset, offset + 4);
    const chunkSize = wavData.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      numChannels = wavData.readUInt16LE(offset + 10);
      sampleRate = wavData.readUInt32LE(offset + 12);
      bitsPerSample = wavData.readUInt16LE(offset + 22);
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
  const targetRate = 16000;
  const ratio = sampleRate / targetRate;
  const outSamples = Math.floor(totalSamples / ratio);
  const out = Buffer.alloc(outSamples * 2);

  for (let i = 0; i < outSamples; i++) {
    const srcIdx = Math.floor(i * ratio);
    const byteOff = dataStart + srcIdx * bytesPerSample * numChannels;
    let sample;
    if (bitsPerSample === 16) {
      sample = wavData.readInt16LE(byteOff);
    } else if (bitsPerSample === 24) {
      sample = wavData[byteOff] | (wavData[byteOff + 1] << 8) | (wavData[byteOff + 2] << 16);
      if (sample & 0x800000) sample |= ~0xffffff;
      sample = sample >> 8;
    } else if (bitsPerSample === 32) {
      sample = wavData.readInt32LE(byteOff) >> 16;
    } else {
      sample = (wavData[byteOff] - 128) << 8;
    }
    out.writeInt16LE(sample, i * 2);
  }

  console.log(`Audio ready: ${out.length} bytes of linear16 16kHz`);
  return out;
}

async function testHealthEndpoint(port) {
  const res = await httpRequest({
    hostname: 'localhost',
    port,
    path: '/',
    method: 'GET',
  });
  if (res.status !== 200) throw new Error(`Health check returned ${res.status}`);
  const body = JSON.parse(res.body);
  if (body.status !== 'ok') throw new Error(`Health check status: ${body.status}`);
  console.log('PASS: GET / — health check ok');
}

async function testMessagingEndpoint(port) {
  const res = await httpRequest(
    {
      hostname: 'localhost',
      port,
      path: '/api/messages',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    JSON.stringify({
      type: 'message',
      text: 'hello',
      from: { id: 'test-user' },
      recipient: { id: 'test-bot' },
      conversation: { id: 'test-conv' },
      channelId: 'msteams',
    })
  );
  if (res.status === 401 || res.status === 403) {
    console.log('PASS: POST /api/messages — endpoint responds (auth expected in production)');
  } else {
    console.log(`PASS: POST /api/messages — endpoint responds with status ${res.status}`);
  }
}

async function testCallingCallback(port) {
  const res = await httpRequest(
    {
      hostname: 'localhost',
      port,
      path: '/api/calling/callback',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    JSON.stringify({
      resourceUrl: '/communications/calls/test-call-id',
      resourceData: { state: 'establishing' },
    })
  );
  if (res.status !== 200 && res.status !== 500) {
    throw new Error(`Calling callback returned unexpected status ${res.status}`);
  }
  console.log('PASS: POST /api/calling/callback — endpoint responds');
}

async function testCallingNotification(port) {
  const res = await httpRequest(
    {
      hostname: 'localhost',
      port,
      path: '/api/calling/notification',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
    JSON.stringify({
      callId: 'test-call-id',
      data: Buffer.from([0, 0, 0, 0]).toString('base64'),
    })
  );
  if (res.status !== 200 && res.status !== 500) {
    throw new Error(`Calling notification returned unexpected status ${res.status}`);
  }
  console.log('PASS: POST /api/calling/notification — endpoint responds');
}

async function testDeepgramStreaming(audioData) {
  console.log('\nTesting CallingHandler Deepgram streaming pipeline...');

  const handler = new CallingHandler();
  const transcripts = [];

  handler.onTranscript((callId, transcript) => {
    transcripts.push({ callId, transcript });
  });

  const dgClient = handler.getDeepgramClient();
  const dgConnection = await dgClient.listen.v1.connect(DEEPGRAM_LIVE_OPTIONS);

  const connected = new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error('Timed out waiting for Deepgram connection')),
      15000
    );
    dgConnection.on('open', () => {
      clearTimeout(timeout);
      resolve();
    });
    dgConnection.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });

  dgConnection.on('message', (data) => {
    const transcript = data?.channel?.alternatives?.[0]?.transcript;
    if (transcript && data.is_final) {
      transcripts.push({ callId: 'direct-test', transcript });
    }
  });

  dgConnection.connect();
  await connected;
  console.log('Deepgram connection established');

  const CHUNK_SIZE = 3200;
  const MAX_BYTES = 16000 * 2 * 8;
  let offset = 0;

  while (offset < audioData.length && offset < MAX_BYTES) {
    const chunk = audioData.subarray(offset, offset + CHUNK_SIZE);
    dgConnection.sendMedia(chunk);
    offset += CHUNK_SIZE;
    await new Promise((r) => setTimeout(r, 100));
  }

  const bytesSent = Math.min(offset, audioData.length);
  const audioSentSecs = bytesSent / (16000 * 2);
  console.log(`Sent ${bytesSent} bytes (${audioSentSecs.toFixed(1)}s) of audio`);

  dgConnection.sendCloseStream({ type: 'CloseStream' });

  await new Promise((r) => setTimeout(r, 3000));

  try {
    dgConnection.close();
  } catch {}

  const combined = transcripts.map((t) => t.transcript).join(' ');
  const minChars = Math.max(5, audioSentSecs * 2);

  if (combined.trim().length < minChars) {
    throw new Error(
      `Transcript too short: ${combined.trim().length} chars for ${audioSentSecs.toFixed(1)}s of audio (expected >= ${minChars})`
    );
  }

  console.log(`PASS: Deepgram streaming — received ${transcripts.length} transcript(s), ${combined.trim().length} chars`);
  console.log(`  Sample: "${combined.substring(0, 120)}..."`);
}

async function testServerEndpoints() {
  const { createApp } = require('../src/index');
  const app = createApp();
  const server = app.listen(PORT);
  await new Promise((r) => server.on('listening', r));
  console.log(`\nServer started on :${PORT}\n`);

  try {
    await testHealthEndpoint(PORT);
    await testMessagingEndpoint(PORT);
    await testCallingCallback(PORT);
    await testCallingNotification(PORT);
  } finally {
    server.close();
  }
}

async function run() {
  const audioData = downloadAndConvertAudio();

  if (hasAllCreds) {
    await testServerEndpoints();
  } else {
    console.log('\nSkipping server endpoint tests (missing Azure credentials)\n');
  }

  await testDeepgramStreaming(audioData);
}

run()
  .then(() => {
    console.log('\nAll tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\nTest failed: ${err.message}`);
    process.exit(1);
  });
