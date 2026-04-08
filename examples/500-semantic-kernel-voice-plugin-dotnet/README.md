# Semantic Kernel Voice Plugin with Deepgram (.NET)

A Deepgram plugin for Microsoft Semantic Kernel that exposes speech-to-text (STT) and text-to-speech (TTS) as `[KernelFunction]` attributes. An AI agent can autonomously choose to transcribe audio or synthesize speech during a chat conversation.

## What you'll build

A .NET 8 console app with a Semantic Kernel agent that can transcribe audio from URLs or local files using Deepgram Nova-3, and convert text to speech using Deepgram Aura-2 — all invoked automatically by the AI agent when relevant.

## Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/download/dotnet/8.0)
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- OpenAI account — [get an API key](https://platform.openai.com/api-keys)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `OPENAI_API_KEY` | [OpenAI dashboard → API keys](https://platform.openai.com/api-keys) |

## Install and run

```bash
cp .env.example .env
# Fill in your API keys in .env

cd src
dotnet restore
dotnet run
```

Then try prompts like:
- "Transcribe this audio: https://static.deepgram.com/examples/Bueller-Life-moves-pretty-fast.wav"
- "Say 'Hello world' as audio and save it to greeting.mp3"

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's latest and most accurate STT model |
| `model` (TTS) | `aura-2-thalia-en` | Deepgram's Aura-2 TTS voice |
| `smart_format` | `true` | Adds punctuation, casing, and paragraph formatting |
| `tag` | `deepgram-examples` | Tags API usage for analytics |

## How it works

1. The app creates a Semantic Kernel `Kernel` with an OpenAI chat completion backend.
2. A `DeepgramPlugin` class registers four `[KernelFunction]` methods: `transcribe_url`, `transcribe_file`, `speak_text`, and `speak_text_stream`.
3. `FunctionChoiceBehavior.Auto()` lets the LLM decide when to call Deepgram functions based on the conversation.
4. When the user asks about audio transcription, the agent calls `TranscribeUrlAsync` or `TranscribeFileAsync`, which use Deepgram's pre-recorded STT API.
5. When the user asks for text-to-speech, the agent calls `SpeakTextAsync` (saves to file) or `SpeakTextStreamAsync` (returns base64 audio).

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
