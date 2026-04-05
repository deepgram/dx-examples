# OBS Studio Live Captioning Plugin (C + Deepgram STT)

A native OBS Studio plugin written in C that captures audio from the OBS audio pipeline, streams it in real-time to Deepgram's streaming STT WebSocket API, and renders live transcription as a text source overlay. Ships as a shared library (.so on Linux, .dll on Windows).

## What you'll build

A compiled OBS plugin that hooks into OBS's audio capture pipeline, converts float audio to 16-bit PCM, streams it over a WebSocket to Deepgram's nova-3 model, and displays live captions as an on-screen text overlay — all with sub-second latency.

## Prerequisites

- C compiler (GCC or Clang)
- CMake 3.16+
- OBS Studio 28+ with development headers (`libobs-dev` on Debian/Ubuntu)
- libwebsockets 4.x (`libwebsockets-dev`) or built from source via CMake
- OpenSSL development headers (`libssl-dev`)
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console → API Keys](https://console.deepgram.com/) |

## Install and run

```bash
# Install system dependencies (Debian/Ubuntu)
sudo apt-get install -y cmake gcc libobs-dev libwebsockets-dev libssl-dev

# Clone and build
cd examples/480-obs-captioning-plugin-c/src
cmake -B build
cmake --build build

# Set your API key
export DEEPGRAM_API_KEY="your-key-here"

# Copy the plugin to OBS
cp build/deepgram-captions.so ~/.obs-studio/plugins/deepgram-captions/bin/64bit/
# Then restart OBS Studio
```

If OBS headers are not in the system path, pass the OBS source directory:

```bash
cmake -B build -DOBS_DIR=/path/to/obs-studio
```

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's latest and most accurate STT model |
| `encoding` | `linear16` | 16-bit signed little-endian PCM — native OBS audio converted |
| `sample_rate` | `16000` | 16 kHz — good quality/bandwidth balance for live captioning |
| `interim_results` | `true` | Partial transcripts for real-time display |
| `smart_format` | `true` | Auto-punctuation and number formatting |
| `tag` | `deepgram-examples` | Tags traffic in Deepgram console for identification |

## How it works

1. **Plugin loads** — OBS calls `obs_module_load()`, which reads `DEEPGRAM_API_KEY` from the environment and creates a text overlay source named "Deepgram Captions".
2. **Audio capture** — The plugin registers an audio capture callback on OBS channel 0 (desktop audio). Each audio frame is converted from float planar to 16-bit PCM and written into a lock-protected ring buffer.
3. **WebSocket thread** — A dedicated thread connects to `wss://api.deepgram.com/v1/listen` using libwebsockets with TLS. It continuously reads from the ring buffer and sends binary audio frames.
4. **Transcript display** — Deepgram responds with JSON containing partial and final transcripts. The plugin parses the `transcript` field and updates the text overlay source in real-time.
5. **Shutdown** — On unload, the plugin sends a `CloseStream` message to Deepgram, joins the WebSocket thread, and releases all OBS resources.

## Architecture

```
OBS Audio Pipeline
    │
    ▼
audio_capture_cb()     ←  float → int16 PCM conversion
    │
    ▼
Ring Buffer (64 KB)    ←  lock-protected circular buffer
    │
    ▼
WebSocket Thread       ←  libwebsockets + TLS
    │
    ▼
wss://api.deepgram.com/v1/listen?model=nova-3&...
    │
    ▼
JSON Response          ←  {"channel":{"alternatives":[{"transcript":"..."}]}}
    │
    ▼
OBS Text Source        ←  live caption overlay
```

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
