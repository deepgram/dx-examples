'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const { execSync, spawnSync } = require('child_process');
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
const TMP_MULAW  = '/tmp/twilio_test.mulaw';
// Twilio sends ~20 ms frames; 8 000 Hz × 1 byte/sample × 0.02 s = 160 bytes.
// We use 320 to match Twilio's actual observed frame size.
const CHUNK_SIZE = 320;

function ensureFfmpeg() {
  try {
    execSync('which ffmpeg', { stdio: 'pipe' });
  } catch {
    console.log('ffmpeg not found — installing via apt-get...');
    execSync('sudo apt-get update -qq && sudo apt-get install -qq -y ffmpeg', {
      stdio: 'pipe',
      timeout: 60_000,
    });
  }
}

function prepareMulawAudio() {
  ensureFfmpeg();

  console.log('Downloading test audio...');
  execSync(`curl -s -L -o "${TMP_WAV}" "${AUDIO_URL}"`, { stdio: 'pipe' });

  console.log('Converting to μ-law 8 kHz mono (ffmpeg)...');
  const result = spawnSync('ffmpeg', [
    '-y', '-i', TMP_WAV,
    '-ar', '8000', '-ac', '1', '-f', 'mulaw', TMP_MULAW,
  ], { stdio: 'pipe' });

  if (result.error) {
    throw new Error(`ffmpeg spawn error: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed: ${(result.stderr || Buffer.alloc(0)).toString().slice(0, 300)}`);
  }

  const audio = fs.readFileSync(TMP_MULAW);
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
          // 4. "stop" — call ended
          ws.send(JSON.stringify({ event: 'stop', streamSid: 'MZ_ci_test' }));
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
