'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
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

const EXAMPLE_DIR = path.join(__dirname, '..');
const PORT = 3098;
const AUDIO_URL = 'https://dpgr.am/spacewalk.wav';
const TMP_WAV = '/tmp/nestjs_test.wav';

function downloadAudio() {
  console.log('Downloading test audio...');
  execSync(`curl -s -L -o "${TMP_WAV}" "${AUDIO_URL}"`, { stdio: 'pipe' });
  return fs.readFileSync(TMP_WAV);
}

function wavToLinear16(wavBuffer) {
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

// ── Test 1: Health endpoint ───────────────────────────────────────────────────
function testHealthEndpoint(port) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:${port}/health`, (res) => {
      let body = '';
      res.on('data', c => (body += c));
      res.on('end', () => {
        if (res.statusCode !== 200) return reject(new Error(`/health returned ${res.statusCode}`));
        const data = JSON.parse(body);
        if (data.status !== 'ok') return reject(new Error(`Health check returned: ${body}`));
        console.log('✓ GET /health → { status: "ok" }');
        resolve();
      });
    }).on('error', reject);
  });
}

// ── Test 2: Socket.IO + Deepgram pipeline ─────────────────────────────────────
function testWebSocketTranscription(port, audioData) {
  return new Promise((resolve, reject) => {
    let io;
    try {
      io = require('socket.io-client');
    } catch {
      try {
        io = require(path.join(EXAMPLE_DIR, 'node_modules', 'socket.io-client'));
      } catch {
        reject(new Error('socket.io-client not installed'));
        return;
      }
    }

    const transcripts = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        socket.disconnect();
        reject(new Error(
          'Timed out (30s) waiting for Deepgram transcript.\n' +
          'Check DEEPGRAM_API_KEY and connectivity to api.deepgram.com.',
        ));
      }
    }, 30_000);

    const socket = io(`http://localhost:${port}`, { transports: ['websocket'] });

    socket.on('connect_error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Socket.IO connection failed: ${err.message}`));
      }
    });

    socket.on('transcript', (event) => {
      const tag = event.isFinal ? 'final' : 'interim';
      console.log(`[${tag}] ${event.transcript}`);
      transcripts.push(event);
    });

    socket.on('error', (evt) => {
      if (!settled) {
        settled = true;
        clearTimeout(timeout);
        socket.disconnect();
        reject(new Error(`Server error: ${evt.message}`));
      }
    });

    socket.on('ready', () => {
      console.log('Deepgram ready — streaming audio...');
      const CHUNK_SIZE = 3200; // 100ms of 16-bit 16kHz audio
      const MAX_BYTES = 16000 * 2 * 10; // 10 seconds
      let offset = 0;

      const sendChunk = () => {
        if (settled || !socket.connected) return;

        if (offset >= audioData.length || offset >= MAX_BYTES) {
          setTimeout(() => {
            socket.disconnect();
            setTimeout(() => {
              if (!settled) {
                settled = true;
                clearTimeout(timeout);
                resolve(transcripts);
              }
            }, 2000);
          }, 1000);
          return;
        }

        const chunk = audioData.subarray(offset, offset + CHUNK_SIZE);
        socket.emit('audio', chunk);
        offset += CHUNK_SIZE;
        setTimeout(sendChunk, 20);
      };

      setTimeout(sendChunk, 500);
    });
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function run() {
  console.log('Building TypeScript...');
  execSync('npm run build', { cwd: EXAMPLE_DIR, stdio: 'pipe' });

  const wavData = downloadAudio();
  console.log('Converting to linear16 16 kHz...');
  const audioData = wavToLinear16(wavData);
  console.log(`✓ Audio ready: ${audioData.length} bytes of linear16 16 kHz`);

  // Start the NestJS server as a child process
  const { spawn } = require('child_process');
  const env = { ...process.env, PORT: String(PORT) };
  const server = spawn('node', ['dist/main.js'], { cwd: EXAMPLE_DIR, env, stdio: 'pipe' });

  let serverOutput = '';
  server.stdout.on('data', (d) => { serverOutput += d; process.stdout.write(d); });
  server.stderr.on('data', (d) => { serverOutput += d; process.stderr.write(d); });

  // Wait for server to be ready
  await new Promise((resolve, reject) => {
    const maxWait = setTimeout(() => reject(new Error('Server did not start within 15s')), 15_000);
    const check = () => {
      if (serverOutput.includes('listening')) { clearTimeout(maxWait); resolve(); return; }
      setTimeout(check, 300);
    };
    server.on('exit', (code) => {
      clearTimeout(maxWait);
      reject(new Error(`Server exited with code ${code} before ready`));
    });
    check();
  });

  console.log(`\n✓ Server started on :${PORT}`);

  try {
    await testHealthEndpoint(PORT);

    console.log('\nStreaming audio through Socket.IO → Deepgram (up to 30s)...');
    const transcripts = await testWebSocketTranscription(PORT, audioData);

    console.log(`\n✓ Received ${transcripts.length} transcript event(s)`);
    if (transcripts.length > 0) {
      console.log(`  First: [${transcripts[0].isFinal ? 'final' : 'interim'}] ${transcripts[0].transcript}`);
    }

    const combined = transcripts.map(t => t.transcript).join(' ').toLowerCase();
    const expectedWords = ['spacewalk', 'astronaut', 'nasa'];
    const found = expectedWords.filter(w => combined.includes(w));

    if (found.length === 0) {
      throw new Error(
        `Transcripts arrived but no expected words found.\n` +
        `Got: ${transcripts.slice(0, 3).map(t => t.transcript).join(' | ')}`,
      );
    }
    console.log(`✓ Transcript content verified (found: ${found.join(', ')})`);

  } finally {
    server.kill('SIGTERM');
    await new Promise(r => setTimeout(r, 500));
  }
}

run()
  .then(() => { console.log('\n✓ All tests passed'); process.exit(0); })
  .catch(err => { console.error(`\n✗ Test failed: ${err.message}`); process.exit(1); });
