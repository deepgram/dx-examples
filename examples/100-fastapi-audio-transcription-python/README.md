# FastAPI Audio Transcription API

Accept audio file uploads or URLs and return transcripts powered by Deepgram nova-3. This example gives you a production-ready async API endpoint pattern that you can drop into any FastAPI backend.

## What you'll build

A FastAPI server with two endpoints: `POST /transcribe` accepts audio file uploads (multipart/form-data) and `POST /transcribe-url` accepts a JSON body with a public audio URL. Both return a JSON response with the transcript, confidence score, duration, and word count.

## Prerequisites

- Python 3.10+
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

Copy `.env.example` to `.env` and fill in your API key:

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |

## Install and run

```bash
pip install -r requirements.txt
uvicorn src.main:app --reload
```

Then try it:

```bash
# Transcribe from a URL (Deepgram fetches it server-side — fast)
curl -X POST http://localhost:8000/transcribe-url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://dpgr.am/spacewalk.wav"}'

# Upload a file
curl -X POST http://localhost:8000/transcribe \
  -F "file=@recording.mp3"
```

Interactive API docs are available at [http://localhost:8000/docs](http://localhost:8000/docs).

## How it works

1. FastAPI's `UploadFile` reads the uploaded audio into memory asynchronously
2. `DeepgramClient().listen.v1.media.transcribe_file()` sends the raw bytes to Deepgram — the SDK auto-detects the audio format from the file header
3. For URL transcription, `transcribe_url()` tells Deepgram to fetch the audio server-side — the file never passes through your server
4. nova-3 with `smart_format=True` returns punctuated, formatted text with word-level timestamps
5. The response includes transcript, confidence (0–1), duration, and word count

## Extending this example

- **Add authentication** — wrap endpoints with FastAPI's `Depends()` for API key or OAuth validation
- **Stream large files** — use `request.stream()` instead of `UploadFile` for files larger than ~100 MB
- **Add diarization** — pass `diarize=True` to label speakers in multi-speaker audio
- **Store results** — save transcripts to a database and return a job ID for async processing
- **Add language detection** — omit the `language` parameter and Deepgram will auto-detect

## Related

- [Deepgram pre-recorded STT docs](https://developers.deepgram.com/docs/pre-recorded-audio)
- [Deepgram Python SDK](https://github.com/deepgram/deepgram-python-sdk)
- [FastAPI file uploads](https://fastapi.tiangolo.com/tutorial/request-files/)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org:

| Starter | What it includes |
|---------|-----------------|
| [fastapi-transcription](https://github.com/deepgram-starters/fastapi-transcription) | FastAPI + Deepgram STT starter |
| [fastapi-live-transcription](https://github.com/deepgram-starters/fastapi-live-transcription) | FastAPI + live streaming STT |
| [fastapi-text-to-speech](https://github.com/deepgram-starters/fastapi-text-to-speech) | FastAPI + Deepgram TTS |
