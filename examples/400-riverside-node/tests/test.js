'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');

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

const { createApp, mergeSpeakerTranscripts } = require('../src/index.js');

const KNOWN_AUDIO_URL = 'https://dpgr.am/spacewalk.wav';

function request(server, method, urlPath, body) {
  return new Promise((resolve, reject) => {
    const addr = server.address();
    const options = {
      hostname: '127.0.0.1',
      port: addr.port,
      path: urlPath,
      method,
      headers: { 'Content-Type': 'application/json' },
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function run() {
  const app = createApp();
  const server = http.createServer(app);

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  try {
    // ── Test 1: Health endpoint ──────────────────────────────────────────
    console.log('Test 1: GET /health');
    const health = await request(server, 'GET', '/health');
    assert(health.status === 200, `Expected 200, got ${health.status}`);
    assert(health.body.status === 'ok', `Expected {status:"ok"}, got ${JSON.stringify(health.body)}`);
    console.log('  ✓ Health check passed');

    // ── Test 2: Webhook ignores non-recording.completed events ──────────
    console.log('Test 2: POST /webhook/riverside (non-matching event)');
    const ignored = await request(server, 'POST', '/webhook/riverside', {
      type: 'recording.started',
    });
    assert(ignored.status === 200, `Expected 200, got ${ignored.status}`);
    assert(ignored.body.message === 'Event ignored', `Expected "Event ignored", got ${JSON.stringify(ignored.body)}`);
    console.log('  ✓ Non-matching event ignored');

    // ── Test 3: Webhook rejects empty tracks ────────────────────────────
    console.log('Test 3: POST /webhook/riverside (no tracks)');
    const noTracks = await request(server, 'POST', '/webhook/riverside', {
      type: 'recording.completed',
      tracks: [],
    });
    assert(noTracks.status === 400, `Expected 400, got ${noTracks.status}`);
    console.log('  ✓ Empty tracks rejected');

    // ── Test 4: /transcribe with real audio ─────────────────────────────
    // Uses a publicly-accessible Deepgram-hosted audio file to verify the
    // full pipeline: download → Deepgram STT → merged transcript.
    console.log('Test 4: POST /transcribe (real audio via Deepgram)');
    const result = await request(server, 'POST', '/transcribe', {
      tracks: [
        { participant_name: 'Speaker A', download_url: KNOWN_AUDIO_URL },
      ],
    });
    assert(result.status === 200, `Expected 200, got ${result.status}: ${JSON.stringify(result.body)}`);
    assert(result.body.transcript, 'Expected non-empty transcript');
    assert(result.body.transcript.length >= 30,
      `Transcript too short (${result.body.transcript.length} chars), expected >= 30`);
    assert(result.body.word_count > 0, `Expected word_count > 0, got ${result.body.word_count}`);
    assert(result.body.track_count === 1, `Expected track_count 1, got ${result.body.track_count}`);
    assert(result.body.speakers.includes('Speaker A'), 'Expected "Speaker A" in speakers list');
    console.log(`  ✓ Transcribed ${result.body.word_count} words from 1 track`);
    console.log(`  Preview: "${result.body.transcript.substring(0, 100)}..."`);

    // ── Test 5: mergeSpeakerTranscripts unit test ────────────────────────
    console.log('Test 5: mergeSpeakerTranscripts (unit test)');
    const mockResults = [
      {
        speakerName: 'Alice',
        result: {
          results: {
            channels: [{
              alternatives: [{
                words: [
                  { word: 'hello', punctuated_word: 'Hello', start: 0.0, end: 0.5, confidence: 0.99 },
                  { word: 'world', punctuated_word: 'world.', start: 0.6, end: 1.0, confidence: 0.98 },
                ],
              }],
            }],
          },
        },
      },
      {
        speakerName: 'Bob',
        result: {
          results: {
            channels: [{
              alternatives: [{
                words: [
                  { word: 'hi', punctuated_word: 'Hi', start: 0.3, end: 0.5, confidence: 0.97 },
                  { word: 'there', punctuated_word: 'there!', start: 1.1, end: 1.5, confidence: 0.96 },
                ],
              }],
            }],
          },
        },
      },
    ];
    const merged = mergeSpeakerTranscripts(mockResults);
    assert(merged.word_count === 4, `Expected 4 words, got ${merged.word_count}`);
    assert(merged.track_count === 2, `Expected 2 tracks, got ${merged.track_count}`);
    assert(merged.speakers.includes('Alice'), 'Expected Alice in speakers');
    assert(merged.speakers.includes('Bob'), 'Expected Bob in speakers');
    assert(merged.segments.length >= 2, `Expected >= 2 segments, got ${merged.segments.length}`);
    assert(merged.transcript.includes('[Alice]'), 'Expected [Alice] label');
    assert(merged.transcript.includes('[Bob]'), 'Expected [Bob] label');
    console.log('  ✓ Merge produces correct speaker-labelled output');

    // ── Test 6: Multi-track transcription with real audio ───────────────
    // Simulates a two-participant recording by sending the same audio URL
    // as two separate tracks with different speaker names.
    console.log('Test 6: POST /transcribe (two tracks, real audio)');
    const multi = await request(server, 'POST', '/transcribe', {
      tracks: [
        { participant_name: 'Host', download_url: KNOWN_AUDIO_URL },
        { participant_name: 'Guest', download_url: KNOWN_AUDIO_URL },
      ],
    });
    assert(multi.status === 200, `Expected 200, got ${multi.status}`);
    assert(multi.body.track_count === 2, `Expected 2 tracks, got ${multi.body.track_count}`);
    assert(multi.body.speakers.length === 2, `Expected 2 speakers, got ${multi.body.speakers.length}`);
    assert(multi.body.transcript.includes('[Host]'), 'Expected [Host] label');
    assert(multi.body.transcript.includes('[Guest]'), 'Expected [Guest] label');
    console.log(`  ✓ Multi-track: ${multi.body.word_count} words, ${multi.body.speakers.length} speakers`);

  } finally {
    server.close();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

run()
  .then(() => {
    console.log('\n✓ All tests passed');
    process.exit(0);
  })
  .catch((err) => {
    console.error(`\n✗ Test failed: ${err.message}`);
    process.exit(1);
  });
