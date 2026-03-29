'use strict';

// Load env vars from .env if present — safe to call even in production
// (dotenv only loads vars that aren't already set, so real env vars win)
require('dotenv').config();

// SDK v5: DeepgramClient replaces the old createClient() function from v3/v4.
// If you see examples online using createClient(), they're out of date.
const { DeepgramClient } = require('@deepgram/sdk');

// Allow overriding the audio URL via env so this script is reusable.
// The default is a NASA spacewalk recording Deepgram uses in their docs —
// clear speech, multiple speakers, domain-specific vocabulary (stress-tests accuracy).
const AUDIO_URL = process.env.AUDIO_URL || 'https://dpgr.am/spacewalk.wav';

async function main() {
  if (!process.env.DEEPGRAM_API_KEY) {
    // Fail fast with a clear message rather than a confusing API error.
    // Without this check you'd get a 401 from the SDK with no hint about the cause.
    console.error('Error: DEEPGRAM_API_KEY environment variable is not set.');
    console.error('Copy .env.example to .env and add your API key.');
    process.exit(1);
  }

  // SDK v5: constructor takes an options object, not a bare string.
  // You can also point at a self-hosted instance here:
  //   new DeepgramClient({ apiKey: '...', environment: { base: 'https://your-host.com' } })
  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  console.log(`Transcribing: ${AUDIO_URL}`);

  // SDK v5: all options are in a single flat object — no separate second argument.
  // Old v3 pattern was: transcribeUrl({ url }, { model, smart_format, ... })
  // New v5 pattern is:  transcribeUrl({ url, model, smart_format, ... })
  //
  // SDK v5 also throws on errors rather than returning { result, error }.
  // Use try/catch instead of destructuring.
  const data = await deepgram.listen.v1.media.transcribeUrl({
    url: AUDIO_URL,

    // nova-3 is the current general-purpose model as of 2025.
    // For phone calls: 'nova-3-phonecall'
    // For medical:     'nova-3-medical'
    // For video:       'nova-3-video' (coming soon)
    // nova-2 still works but nova-3 has better accuracy and latency.
    model: 'nova-3',

    // smart_format adds punctuation, capitalisation, paragraph breaks,
    // and formats numbers/dates/currency. Highly recommended — the raw
    // transcript without it is dense and hard to read.
    smart_format: true,

    // diarize labels each word with a speaker number (0, 1, 2...).
    // Useful for multi-speaker audio. Adds ~200ms to response time.
    // Omit for single-speaker audio — it adds noise to the output.
    diarize: true,
  });

  // The response always has at least one channel.
  // Each channel has at least one alternative (N-best lists via `alternatives` option).
  const channel = data.results.channels[0];
  const alternative = channel.alternatives[0];

  console.log('\n── Transcript ──────────────────────────────────');
  console.log(alternative.transcript);

  // Word-level data is present when smart_format or diarize is enabled.
  // Each word has: word, start, end, confidence, speaker (if diarized).
  if (alternative.words?.length > 0) {
    // words.at(-1).end gives total audio duration in seconds — no need to
    // parse the media file separately.
    const duration = alternative.words.at(-1).end;

    console.log('\n── Metadata ────────────────────────────────────');
    console.log(`Duration:    ${duration.toFixed(1)}s`);
    console.log(`Words:       ${alternative.words.length}`);
    // Confidence 0–1. Above 0.9 is excellent; below 0.7 suggests poor
    // audio quality, heavy accent, or domain jargon the model hasn't seen.
    console.log(`Confidence:  ${(alternative.confidence * 100).toFixed(1)}%`);
    console.log(`Model:       ${data.metadata?.model_info ? Object.keys(data.metadata.model_info)[0] : 'nova-3'}`);
  }
}

main().catch(err => {
  // Common errors:
  //   AuthenticationError  — bad or expired API key
  //   BadRequestError      — unsupported audio format or URL not reachable
  //   PaymentRequiredError — free tier quota exceeded
  console.error('Error:', err.message);
  process.exit(1);
});
