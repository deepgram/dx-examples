'use strict';

require('dotenv').config();

// The Vercel AI SDK provides a unified interface across many AI providers.
// @ai-sdk/deepgram is the official Deepgram provider, maintained by Vercel,
// which wraps Deepgram's STT and TTS APIs behind the AI SDK's standard
// transcribe() and generateSpeech() functions.  This means you can swap
// providers (OpenAI Whisper, ElevenLabs, etc.) by changing one import —
// the rest of your code stays the same.
const { deepgram } = require('@ai-sdk/deepgram');
const {
  experimental_transcribe: transcribe,
  experimental_generateSpeech: generateSpeech,
} = require('ai');
const fs = require('fs');
const path = require('path');

const AUDIO_URL = process.env.AUDIO_URL || 'https://dpgr.am/spacewalk.wav';

async function main() {
  if (!process.env.DEEPGRAM_API_KEY) {
    console.error('Error: DEEPGRAM_API_KEY environment variable is not set.');
    console.error('Copy .env.example to .env and add your API key.');
    process.exit(1);
  }

  // ── Part 1: Transcription ─────────────────────────────────────────────────
  // transcribe() is provider-agnostic.  deepgram.transcription('nova-3') tells
  // the AI SDK to route this request through Deepgram's pre-recorded STT API.
  // You could replace it with openai.transcription('whisper-1') and the rest
  // of this code would still work — that's the power of the unified interface.
  //
  // The audio parameter accepts a URL, Buffer, Uint8Array, or file path.
  // When you pass a URL, the AI SDK downloads the file first and then sends
  // the bytes to Deepgram — Deepgram's own transcribeUrl() is more efficient
  // for URLs because Deepgram fetches directly, but the AI SDK approach gives
  // you provider portability.
  console.log(`Transcribing: ${AUDIO_URL}\n`);

  const transcript = await transcribe({
    model: deepgram.transcription('nova-3'),
    audio: new URL(AUDIO_URL),
    // providerOptions lets you pass Deepgram-specific settings that aren't
    // part of the AI SDK's universal interface.  smart_format adds punctuation
    // and number formatting; summarize returns a one-paragraph summary.
    providerOptions: {
      deepgram: {
        smart_format: true,
      },
    },
  });

  console.log('── Transcript ──────────────────────────────────');
  console.log(transcript.text);

  if (transcript.segments?.length > 0) {
    console.log(`\n── Segments: ${transcript.segments.length} ──`);
    // segments contain start/end timestamps when the provider supports them
    for (const seg of transcript.segments.slice(0, 3)) {
      console.log(`  [${seg.start?.toFixed(1)}s–${seg.end?.toFixed(1)}s] ${seg.text}`);
    }
    if (transcript.segments.length > 3) {
      console.log(`  ... and ${transcript.segments.length - 3} more segments`);
    }
  }

  if (transcript.durationInSeconds) {
    console.log(`\nDuration: ${transcript.durationInSeconds.toFixed(1)}s`);
  }

  // ── Part 2: Text-to-Speech ────────────────────────────────────────────────
  // generateSpeech() is the TTS counterpart.  deepgram.speech('aura-2-helena-en')
  // routes through Deepgram's Aura TTS API.  The result contains audio as both
  // a Uint8Array and a base64 string — pick whichever is convenient.
  //
  // aura-2-helena-en is a natural-sounding female English voice.  Other voices:
  //   aura-2-thalia-en, aura-2-luna-en, aura-2-asteria-en, etc.
  // Full list: https://developers.deepgram.com/docs/tts-models
  console.log('\n── Text-to-Speech ──────────────────────────────');

  const speech = await generateSpeech({
    model: deepgram.speech('aura-2-helena-en'),
    text: 'The Vercel AI SDK makes it easy to integrate Deepgram speech services into any Node.js application.',
    providerOptions: {
      deepgram: {
        // linear16 is raw PCM — easier to inspect and pipe to other tools.
        // Default is mp3 which is smaller but harder to validate programmatically.
        encoding: 'linear16',
        sample_rate: 24000,
      },
    },
  });

  const outDir = path.join(__dirname, '..', 'output');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const outPath = path.join(outDir, 'speech.raw');
  fs.writeFileSync(outPath, Buffer.from(speech.audio.uint8Array));
  console.log(`Speech audio saved to ${outPath}`);
  console.log(`  Size: ${speech.audio.uint8Array.length} bytes`);
  console.log(`  Format: linear16 PCM, 24 kHz, mono`);
  // To play: ffplay -f s16le -ar 24000 -ac 1 output/speech.raw
  console.log(`  Play:  ffplay -f s16le -ar 24000 -ac 1 ${outPath}`);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
