'use strict';

const fs = require('fs');
const path = require('path');

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

require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { transcribeAudio, speakText } = require('../src/tools');
const { voiceAgent, runAgent } = require('../src/agent');

const KNOWN_AUDIO_URL = 'https://dpgr.am/spacewalk.wav';

async function run() {
  // ── Test 1: Module exports ────────────────────────────────────────────────
  console.log('Test 1: Verify module exports');
  if (!transcribeAudio || typeof transcribeAudio.execute !== 'function') {
    throw new Error('src/tools.js must export transcribeAudio tool with execute()');
  }
  if (!speakText || typeof speakText.execute !== 'function') {
    throw new Error('src/tools.js must export speakText tool with execute()');
  }
  if (!voiceAgent || voiceAgent.version !== 'agent-v1') {
    throw new Error('src/agent.js must export voiceAgent (ToolLoopAgent)');
  }
  if (typeof runAgent !== 'function') {
    throw new Error('src/agent.js must export runAgent()');
  }
  console.log('  ✓ All exports present\n');

  // ── Test 2: transcribeAudio tool via src/tools.js ─────────────────────────
  console.log('Test 2: transcribeAudio tool (Deepgram STT via @ai-sdk/deepgram)');
  const sttResult = await transcribeAudio.execute(
    { url: KNOWN_AUDIO_URL },
    { toolCallId: 'test-stt', messages: [] }
  );

  if (!sttResult.transcript || sttResult.transcript.length < 20) {
    throw new Error(`Transcript too short or empty: "${sttResult.transcript}"`);
  }
  // spacewalk.wav is ~33 s — expect at least 2 chars/sec
  const minChars = Math.floor(33 * 2);
  if (sttResult.transcript.length < minChars) {
    throw new Error(
      `Transcript suspiciously short (${sttResult.transcript.length} chars) for 33 s audio`
    );
  }
  console.log(`  ✓ Transcription: ${sttResult.transcript.length} chars`);
  console.log(`  Preview: "${sttResult.transcript.substring(0, 80)}..."\n`);

  // ── Test 3: speakText tool via src/tools.js ───────────────────────────────
  console.log('Test 3: speakText tool (Deepgram TTS via @ai-sdk/deepgram)');
  const ttsResult = await speakText.execute(
    { text: 'Hello from the Vercel AI SDK agent test suite.' },
    { toolCallId: 'test-tts', messages: [] }
  );

  if (!ttsResult.audioBytes || ttsResult.audioBytes < 1000) {
    throw new Error(`TTS audio too small: ${ttsResult.audioBytes} bytes`);
  }
  if (!ttsResult.audioBase64 || ttsResult.audioBase64.length < 100) {
    throw new Error('TTS audioBase64 missing or too short');
  }
  console.log(`  ✓ TTS: ${ttsResult.audioBytes} bytes\n`);

  // ── Test 4: Full agent run via src/agent.js ───────────────────────────────
  console.log('Test 4: Full agent run (STT → LLM reasoning → TTS)');
  const result = await runAgent(
    `Please transcribe the audio at ${KNOWN_AUDIO_URL}, give a one-sentence summary, and then speak that summary aloud.`
  );

  if (!result.text || result.text.length < 10) {
    throw new Error(`Agent response too short: "${result.text}"`);
  }

  // The agent should have used at least 2 tools: transcribeAudio and speakText
  const allToolCalls = result.steps.flatMap(s => s.toolCalls || []);
  const toolNames = allToolCalls.map(tc => tc.toolName);

  if (!toolNames.includes('transcribeAudio')) {
    throw new Error('Agent did not call transcribeAudio tool');
  }
  if (!toolNames.includes('speakText')) {
    throw new Error('Agent did not call speakText tool');
  }

  console.log(`  ✓ Agent completed in ${result.steps.length} steps`);
  console.log(`  Tools called: ${toolNames.join(', ')}`);
  console.log(`  Response: "${result.text.substring(0, 100)}..."\n`);
}

run()
  .then(() => {
    console.log('All tests passed');
    process.exit(0);
  })
  .catch(err => {
    console.error(`\nTest failed: ${err.message}`);
    process.exit(1);
  });
