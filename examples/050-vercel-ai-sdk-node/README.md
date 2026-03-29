# Vercel AI SDK — Transcribe Audio and Generate Speech with Deepgram

Use the Vercel AI SDK's unified interface to transcribe audio and generate speech with Deepgram, using the same API patterns you'd use with any other AI provider. Swap between Deepgram, OpenAI, and others by changing one import.

## What you'll build

A Node.js script that does two things: transcribes an audio file using Deepgram's nova-3 model via the AI SDK's `transcribe()` function, then generates speech audio from text using Deepgram's Aura 2 TTS via the AI SDK's `generateSpeech()` function. The transcript prints to the console; the generated audio saves to a file you can play back.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

Copy `.env.example` to `.env` and fill in your API key:

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console → API Keys](https://console.deepgram.com/) |

## Install and run

```bash
npm install
npm start
```

To transcribe a different file, set the `AUDIO_URL` environment variable:

```bash
AUDIO_URL=https://example.com/my-audio.wav npm start
```

## How it works

1. `transcribe()` from the `ai` package provides a provider-agnostic transcription interface
2. `deepgram.transcription('nova-3')` routes the request through the `@ai-sdk/deepgram` provider to Deepgram's pre-recorded STT API
3. The transcript is returned with text, segments (with timestamps), and duration metadata
4. `generateSpeech()` provides a provider-agnostic TTS interface
5. `deepgram.speech('aura-2-helena-en')` routes through Deepgram's Aura TTS API
6. The generated audio is saved as a raw PCM file

The key advantage of the AI SDK approach is portability: you can swap `deepgram.transcription('nova-3')` for `openai.transcription('whisper-1')` without changing any other code.

## Related

- [Vercel AI SDK Deepgram provider docs](https://ai-sdk.dev/providers/ai-sdk-providers/deepgram)
- [Vercel AI SDK transcription docs](https://ai-sdk.dev/docs/ai-sdk-core/transcription)
- [Vercel AI SDK speech docs](https://ai-sdk.dev/docs/ai-sdk-core/speech)
- [Deepgram pre-recorded STT docs](https://developers.deepgram.com/docs/pre-recorded-audio)
- [Deepgram TTS docs](https://developers.deepgram.com/docs/text-to-speech)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
