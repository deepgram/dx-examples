'use strict';

const { z } = require('zod');
const {
  tool,
  zodSchema,
  experimental_transcribe: transcribe,
  experimental_generateSpeech: generateSpeech,
} = require('ai');
const { deepgram } = require('@ai-sdk/deepgram');

// Deepgram STT wrapped as an AI SDK tool — the agent calls this whenever it
// needs to understand what the user said.  Accepts a public audio URL and
// returns the transcript text.
const transcribeAudio = tool({
  description:
    'Transcribe an audio file at a public URL into text using Deepgram nova-3.',
  inputSchema: zodSchema(z.object({
    url: z.string().url().describe('Public URL of an audio file to transcribe'),
  })),
  execute: async ({ url }) => {
    // Route through @ai-sdk/deepgram — never call DeepgramClient directly.
    // smart_format adds punctuation and number formatting automatically.
    const result = await transcribe({
      model: deepgram.transcription('nova-3'),
      audio: new URL(url),
      providerOptions: {
        deepgram: { smart_format: true, tag: 'deepgram-examples' },
      },
    });

    return {
      transcript: result.text,
      durationSeconds: result.durationInSeconds ?? null,
      segmentCount: result.segments?.length ?? 0,
    };
  },
});

// Deepgram TTS wrapped as an AI SDK tool — the agent calls this whenever it
// needs to speak a response aloud.  Returns raw PCM audio metadata (the bytes
// are saved to disk so the caller can play them).
const speakText = tool({
  description:
    'Convert text to speech using Deepgram Aura 2.  Returns audio metadata.',
  inputSchema: zodSchema(z.object({
    text: z.string().min(1).describe('The text to speak aloud'),
  })),
  execute: async ({ text }) => {
    const result = await generateSpeech({
      model: deepgram.speech('aura-2-helena-en'),
      text,
      providerOptions: {
        deepgram: {
          encoding: 'linear16',
          sample_rate: 24000,
          tag: 'deepgram-examples',
        },
      },
    });

    return {
      audioBytes: result.audio.uint8Array.length,
      format: 'linear16 PCM, 24 kHz, mono',
      audioBase64: result.audio.base64,
    };
  },
  // Strip the base64 audio before sending the tool result back to the LLM —
  // raw audio would blow the context window.  The full result (with audioBase64)
  // is still available to the caller via step.toolResults.
  toModelOutput: ({ output }) => ({
    type: 'text',
    value: JSON.stringify({
      audioBytes: output.audioBytes,
      format: output.format,
      status: 'audio generated successfully',
    }),
  }),
});

module.exports = { transcribeAudio, speakText };
