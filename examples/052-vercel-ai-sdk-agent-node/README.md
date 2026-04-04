# Vercel AI SDK Agent with Deepgram Voice Tools

Build an AI agent that can listen to audio and speak responses using the Vercel AI SDK's `ToolLoopAgent` with Deepgram STT and TTS as callable tools. The agent autonomously decides when to transcribe audio and when to speak, enabling multi-step voice-driven workflows.

## What you'll build

A Node.js agent that receives an audio URL, transcribes it using Deepgram nova-3 (via `@ai-sdk/deepgram`), reasons about the content using an LLM, and speaks a summary back using Deepgram Aura 2 TTS — all orchestrated by the Vercel AI SDK's agent framework.

## Prerequisites

- Node.js >= 18
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- OpenAI account — [get an API key](https://platform.openai.com/api-keys)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `OPENAI_API_KEY` | [OpenAI platform → API keys](https://platform.openai.com/api-keys) |

## Install and run

```bash
cp .env.example .env
# Fill in your API keys in .env

pnpm install
pnpm start
```

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` (STT) | `nova-3` | Deepgram's latest speech-to-text model, used via `@ai-sdk/deepgram` |
| `model` (TTS) | `aura-2-helena-en` | Natural-sounding female English voice for text-to-speech |
| `model` (LLM) | `gpt-4o-mini` | OpenAI model for the agent's reasoning (swappable via AI SDK) |
| `smart_format` | `true` | Adds punctuation and number formatting to transcripts |
| `encoding` | `linear16` | Raw PCM output for TTS — easy to inspect and pipe |
| `sample_rate` | `24000` | 24 kHz audio output for TTS |

## How it works

1. **Agent initialisation** — A `ToolLoopAgent` is created with two Deepgram-powered tools (`transcribeAudio` and `speakText`) and an LLM for reasoning.
2. **Tool: transcribeAudio** — When the agent needs to understand audio, it calls this tool which uses `@ai-sdk/deepgram`'s `transcribe()` with Deepgram nova-3.
3. **LLM reasoning** — The agent processes the transcript, extracts key points, and decides what to say.
4. **Tool: speakText** — The agent calls this tool to convert its response to speech using `@ai-sdk/deepgram`'s `generateSpeech()` with Deepgram Aura 2.
5. **Output** — The agent returns both a written summary and the spoken audio file.

The AI SDK's tool loop means the agent autonomously decides the order and frequency of tool calls — it might transcribe multiple audio files, or speak multiple responses, without any hardcoded workflow.

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
