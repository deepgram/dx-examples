# Django Channels Real-Time Transcription with Deepgram Live STT

Build a Django 5 application that captures browser microphone audio and streams it through Django Channels WebSockets to Deepgram's Live STT API, displaying transcription results on the page in real-time. The Deepgram API key stays server-side — the browser never sees it.

## What you'll build

A Django web application that uses Django Channels to handle WebSocket connections from the browser. When a user clicks "Start Listening", the page captures microphone audio, streams it over a WebSocket to a Django Channels consumer, which forwards it to Deepgram's Live STT API (Nova-3). Transcription results flow back through the same WebSocket and appear on the page instantly.

## Prerequisites

- Python 3.11+
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |

Copy `.env.example` to `.env` and fill in your values.

## Install and run

```bash
cd examples/220-django-channels-live-stt-python

pip install -r requirements.txt

cp .env.example .env
# Edit .env and add your DEEPGRAM_API_KEY

python src/manage.py runserver
```

Then open http://127.0.0.1:8000 in your browser and click **Start Listening**.

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's latest and most accurate speech recognition model |
| `smart_format` | `True` | Adds punctuation, capitalization, and number formatting |
| `interim_results` | `True` | Returns partial transcripts while you're still speaking |
| `encoding` | `linear16` | Raw 16-bit PCM audio format from the browser |
| `sample_rate` | `16000` | 16 kHz sample rate — good balance of quality and bandwidth |

## How it works

1. **Browser** — the HTML page uses `getUserMedia` to capture microphone audio, resamples it to 16 kHz linear16 PCM via a `ScriptProcessorNode`, and sends binary frames over a WebSocket to `/ws/transcribe/`
2. **Django Channels consumer** (`consumer.py`) — an `AsyncWebsocketConsumer` that on connect opens a Deepgram live STT WebSocket using the official Python SDK (`client.listen.v1.connect()`)
3. **Audio forwarding** — each binary WebSocket frame from the browser is forwarded to Deepgram via `connection.send_media()`
4. **Transcript delivery** — Deepgram fires `EventType.MESSAGE` callbacks with `ListenV1Results`; the consumer sends each transcript back to the browser as JSON with `is_final` indicating whether the result is finalized
5. **Browser display** — interim results appear greyed out and get replaced; final results are appended permanently

## Architecture

```
Browser Microphone
       |
       | WebSocket (binary PCM audio)
       v
Django Channels Consumer
       |
       | Deepgram Python SDK (WebSocket)
       v
Deepgram Live STT (nova-3)
       |
       | transcript JSON
       v
Django Channels Consumer
       |
       | WebSocket (JSON)
       v
Browser Display
```

## Related

- [Deepgram Live STT docs](https://developers.deepgram.com/docs/getting-started-with-live-streaming-audio)
- [Deepgram Python SDK](https://github.com/deepgram/deepgram-python-sdk)
- [Django Channels documentation](https://channels.readthedocs.io/)
- [Daphne ASGI server](https://github.com/django/daphne)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
