# OpenAI Agents SDK Voice Pipeline with Deepgram STT & TTS

Build a conversational voice agent using the OpenAI Agents SDK with Deepgram powering the speech layer. Deepgram nova-3 handles real-time speech-to-text, Deepgram aura-2 handles text-to-speech, and an OpenAI agent provides the conversational reasoning with tool-calling support.

## What you'll build

A Python voice agent that listens to speech, transcribes it with Deepgram, processes it through an OpenAI agent (GPT-4.1-mini), and speaks the response back using Deepgram TTS. The example includes a single-turn demo mode (no microphone needed) and an interactive streaming mode for real-time conversation.

## Prerequisites

- Python 3.10+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- OpenAI account — [get an API key](https://platform.openai.com/api-keys)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `OPENAI_API_KEY` | [OpenAI dashboard](https://platform.openai.com/api-keys) |

Copy `.env.example` to `.env` and fill in your values.

## Install and run

```bash
pip install -r requirements.txt

# Single-turn demo — transcribes a sample audio file, no microphone needed
python src/agent.py

# Interactive streaming mode — continuous conversation via microphone
python src/agent.py --stream
```

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` (STT) | `nova-3` | Deepgram's latest and most accurate speech recognition model |
| `model` (TTS) | `aura-2-asteria-en` | Natural conversational voice for TTS streaming |
| `model` (LLM) | `gpt-4.1-mini` | Fast, cost-effective OpenAI model for agent reasoning |
| `smart_format` | `True` | Adds punctuation, capitalization, and number formatting to transcripts |
| `interim_results` | `True` | Returns partial transcripts as audio is processed (streaming mode) |

## How it works

1. **Custom Deepgram Provider** — implements the OpenAI Agents SDK's `VoiceModelProvider` interface, wiring `DeepgramSTTModel` and `DeepgramTTSModel` into the pipeline
2. **Deepgram STT** (nova-3) transcribes audio via the live WebSocket API for streaming, or the pre-recorded API for single-turn — the official Python SDK handles connection management
3. **OpenAI Agent** (GPT-4.1-mini) receives the transcript and generates a conversational response, with full support for the Agents SDK's tool-calling and handoff features
4. **Deepgram TTS** (aura-2) synthesises the response over a WebSocket connection, streaming audio chunks back as they're generated for minimal latency
5. The `VoicePipeline` orchestrates the flow: audio in → STT → agent → TTS → audio out

## Architecture

```
Audio Input -> [Deepgram STT (nova-3)] -> [OpenAI Agent (GPT-4.1-mini)] -> [Deepgram TTS (aura-2)] -> Audio Output
                                                    |
                                              Tool calling,
                                             conversation
                                               history
```

## Related

- [OpenAI Agents SDK documentation](https://openai.github.io/openai-agents-python/)
- [OpenAI Agents SDK voice pipeline](https://openai.github.io/openai-agents-python/voice/quickstart/)
- [Deepgram STT docs](https://developers.deepgram.com/docs/streaming)
- [Deepgram TTS docs](https://developers.deepgram.com/docs/text-to-speech)
- [Deepgram Python SDK](https://github.com/deepgram/deepgram-python-sdk)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
