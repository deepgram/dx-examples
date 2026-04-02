# CrewAI Voice-Enabled Multi-Agent System with Deepgram

Build a multi-agent voice pipeline using CrewAI and Deepgram. A crew of three AI agents collaborates to process spoken audio: one transcribes speech with Deepgram STT, one analyses the content, and one delivers the response as spoken audio via Deepgram TTS.

## What you'll build

A Python application where a CrewAI crew processes audio end-to-end: a Voice Listener agent transcribes audio using Deepgram nova-3, a Research Analyst agent extracts key insights from the transcript, and a Voice Speaker agent synthesises the analysis into spoken audio using Deepgram aura-2. The agents coordinate sequentially, passing context from one to the next.

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

# Run with default sample audio (NASA spacewalk recording)
python src/crew.py

# Run with your own audio file or URL
python src/crew.py path/to/audio.wav
python src/crew.py https://example.com/audio.mp3
```

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` (STT) | `nova-3` | Deepgram's most accurate speech recognition model |
| `model` (TTS) | `aura-2-asteria-en` | Natural conversational voice for spoken output |
| `smart_format` | `True` | Adds punctuation, capitalisation, and number formatting |
| `process` | `Process.sequential` | Agents execute in order — listener, researcher, speaker |

## How it works

1. **Voice Listener agent** receives an audio source (URL or file path) and calls the `transcribe_audio` tool, which uses the Deepgram Python SDK to transcribe with nova-3
2. **Research Analyst agent** receives the transcript and produces a concise, voice-friendly summary of the key points and insights
3. **Voice Speaker agent** takes the summary, cleans it for natural speech, and calls the `speak_text` tool to generate a WAV file via Deepgram TTS (aura-2)
4. The crew runs sequentially via `Process.sequential` — each task's output is automatically passed as context to the next agent

## Architecture

```
Audio Input
    |
    v
[Voice Listener Agent]
    | transcribe_audio tool -> Deepgram STT (nova-3)
    v
[Research Analyst Agent]
    | LLM analysis (GPT-4.1-mini)
    v
[Voice Speaker Agent]
    | speak_text tool -> Deepgram TTS (aura-2)
    v
Audio Output (WAV file)
```

## Related

- [CrewAI documentation](https://docs.crewai.com/)
- [CrewAI GitHub](https://github.com/crewAIInc/crewAI)
- [Deepgram STT docs](https://developers.deepgram.com/docs/streaming)
- [Deepgram TTS docs](https://developers.deepgram.com/docs/text-to-speech)
- [Deepgram Python SDK](https://github.com/deepgram/deepgram-python-sdk)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
