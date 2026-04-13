# Silero VAD Speech Segmentation with Deepgram STT

Use Silero VAD to detect speech regions in an audio file, then transcribe each segment individually with Deepgram. This is a common pre-processing pattern for long recordings where you want timestamped transcripts aligned to actual speech boundaries rather than fixed-length chunks.

## What you'll build

A Python CLI tool that loads an audio file, runs Silero VAD to find speech vs. silence boundaries, extracts each speech segment, sends it to Deepgram for transcription, and outputs a timestamped transcript.

## Prerequisites

- Python 3.9+
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |

## Install and run

```bash
cp .env.example .env
# Add your DEEPGRAM_API_KEY to .env

pip install -r requirements.txt

python src/segmenter.py path/to/audio.wav
```

### CLI options

```bash
python src/segmenter.py audio.wav --threshold 0.4 --min-speech 500 --min-silence 300 --pad 50
```

## Key parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `--threshold` | `0.5` | VAD speech probability threshold (0–1). Lower catches quieter speech. |
| `--min-speech` | `250` | Minimum speech duration in ms to keep a segment |
| `--min-silence` | `100` | Minimum silence duration in ms to split between segments |
| `--pad` | `30` | Padding in ms added around each detected speech region |
| `model` | `nova-3` | Deepgram transcription model |

## How it works

1. **Load audio** — `silero_vad.read_audio()` reads the file and resamples to 16 kHz mono
2. **Run VAD** — `get_speech_timestamps()` scans the waveform and returns sample-level start/end boundaries for each speech region
3. **Extract segments** — Each region is sliced from the waveform and encoded as a 16-bit PCM WAV buffer
4. **Transcribe** — Each WAV buffer is sent to `client.listen.v1.media.transcribe_file()` with the `nova-3` model
5. **Output** — Results are printed as timestamped transcript lines

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
