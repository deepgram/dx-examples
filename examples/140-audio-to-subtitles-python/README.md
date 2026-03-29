# Audio to Subtitles CLI

Generate SRT or WebVTT subtitle files from any audio or video file using Deepgram's nova-3 speech-to-text. Pass a local file or a public URL and get a properly timed subtitle file in seconds — no ffmpeg, no manual syncing.

## What you'll build

A Python command-line tool that transcribes audio and outputs industry-standard subtitle files. Run `python src/caption.py recording.mp3` and get `recording.srt` with perfectly timed captions. Supports both SRT (for video editors, media players) and WebVTT (for HTML5 `<track>` elements, web players). Optional speaker diarization adds speaker labels for interviews and meetings.

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

# Transcribe a local file (outputs recording.srt by default)
export DEEPGRAM_API_KEY=your_key_here
python src/caption.py recording.mp3

# Transcribe from a URL, output as WebVTT
python src/caption.py --url https://dpgr.am/spacewalk.wav --format vtt

# Multi-speaker interview with speaker labels
python src/caption.py interview.wav --diarize

# Explicit output path
python src/caption.py podcast.mp3 --output episode-42.srt

# Use a specialized model for medical audio
python src/caption.py consultation.wav --model nova-3-medical
```

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | General-purpose STT model. Use `nova-3-medical` for medical audio |
| `smart_format` | `True` | Adds punctuation, capitalizes sentences, formats numbers and dates |
| `utterances` | `True` | Splits transcript at natural pauses — essential for subtitle timing |
| `diarize` | `False` | Set `True` to add speaker labels. Adds ~200ms but valuable for multi-speaker audio |

## How it works

1. The CLI reads a local audio file into memory or passes a URL to Deepgram
2. `transcribe_file()` uploads the raw bytes — the SDK auto-detects the audio format from the file header (mp3, wav, flac, ogg, m4a, etc.)
3. `transcribe_url()` tells Deepgram to fetch the audio server-side — the file never passes through your machine
4. `utterances=True` makes Deepgram split the transcript at natural pauses, which produces subtitle blocks with natural timing
5. The `deepgram-captions` library converts the Deepgram response into properly formatted SRT or WebVTT, handling timestamp formatting and line length

## Output formats

**SRT (SubRip)** — universal subtitle format supported by every video editor and media player:
```
1
00:00:00,000 --> 00:00:04,240
This is the first subtitle line.

2
00:00:04,800 --> 00:00:08,160
And this is the second one.
```

**WebVTT** — web-native format for HTML5 `<video>` and `<audio>` elements:
```
WEBVTT

00:00:00.000 --> 00:00:04.240
This is the first subtitle line.

00:00:04.800 --> 00:00:08.160
And this is the second one.
```

## Related

- [Deepgram pre-recorded STT docs](https://developers.deepgram.com/docs/pre-recorded-audio)
- [Deepgram Python SDK](https://github.com/deepgram/deepgram-python-sdk)
- [deepgram-captions Python library](https://github.com/deepgram/deepgram-python-captions)
- [SRT format specification](https://en.wikipedia.org/wiki/SubRip#Format)
- [WebVTT specification](https://developer.mozilla.org/en-US/docs/Web/API/WebVTT_API)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
