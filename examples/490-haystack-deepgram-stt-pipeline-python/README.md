# Haystack Audio Transcription Pipeline with Deepgram STT

A Python example showing how to use Deepgram as a custom Haystack 2.x component for audio transcription in a RAG pipeline. Audio URLs go in, searchable Haystack Documents come out — complete with speaker labels, word timestamps, and confidence scores.

## What you'll build

A custom Haystack `@component` called `DeepgramTranscriber` that accepts audio URLs, transcribes them via Deepgram Pre-recorded STT (Nova-3), and outputs Haystack `Document` objects. The example includes a full ingestion pipeline that cleans transcripts and writes them to an in-memory document store for retrieval.

## Prerequisites

- Python 3.10+
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) → Settings → API Keys |

## Install and run

```bash
cp .env.example .env
# Add your DEEPGRAM_API_KEY to .env

pip install -r requirements.txt

# Transcribe a single audio file
python src/transcriber.py https://dpgr.am/spacewalk.wav

# Batch transcribe multiple files
python src/transcriber.py https://dpgr.am/spacewalk.wav https://dpgr.am/spacewalk.wav
```

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's flagship speech model with highest accuracy |
| `smart_format` | `True` | Adds punctuation, capitalisation, and number formatting |
| `diarize` | `True` | Enables speaker diarization — each word gets a speaker ID |
| `language` | `en` | Language code for transcription |

## How it works

1. `DeepgramTranscriber` is a Haystack 2.x `@component` with an `run(urls=...)` method
2. For each URL, it calls Deepgram Pre-recorded STT with Nova-3 and diarization enabled
3. Deepgram fetches and processes the audio server-side (no local download needed)
4. Each transcript becomes a Haystack `Document` with metadata: duration, confidence, word timestamps, speaker labels
5. The ingestion pipeline passes documents through `DocumentCleaner` and into `InMemoryDocumentStore`
6. Documents in the store are ready for retrieval, filtering by metadata, or further RAG processing

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
