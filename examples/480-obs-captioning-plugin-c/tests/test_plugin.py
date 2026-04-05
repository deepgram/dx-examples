"""
Tests for OBS Studio Deepgram captioning plugin (480).

Since the OBS plugin requires the OBS runtime to load, tests validate:
  1. File structure and required source files exist
  2. Source code uses correct Deepgram API patterns (nova-3, tag, linear16)
  3. CMakeLists.txt links required dependencies
  4. Live WebSocket connection to Deepgram with the same parameters the plugin uses

Exit codes: 0 = pass, 1 = failure, 2 = missing credentials
"""

import os
import sys
import json
import struct
import time
import math
from pathlib import Path

ROOT = Path(__file__).parent.parent
SRC = ROOT / "src"

env_example = ROOT / ".env.example"
required = [
    line.split("=")[0].strip()
    for line in env_example.read_text().splitlines()
    if line.strip() and not line.startswith("#") and "=" in line and line[0].isupper()
]
missing = [k for k in required if not os.environ.get(k)]
if missing:
    print(f"MISSING_CREDENTIALS: {','.join(missing)}", file=sys.stderr)
    sys.exit(2)


def test_file_structure():
    required_files = [
        ".env.example",
        "README.md",
        "src/deepgram-caption-plugin.c",
        "src/CMakeLists.txt",
    ]
    for f in required_files:
        assert (ROOT / f).exists(), f"Required file missing: {f}"


def test_source_code_patterns():
    plugin_src = (SRC / "deepgram-caption-plugin.c").read_text()

    assert "nova-3" in plugin_src, "Uses nova-3 model"
    assert "deepgram-examples" in plugin_src, "Includes deepgram-examples tag"
    assert "linear16" in plugin_src, "Uses linear16 encoding"
    assert "sample_rate=16000" in plugin_src, "Uses 16 kHz sample rate"
    assert "interim_results=true" in plugin_src, "Enables interim results"
    assert "smart_format=true" in plugin_src, "Enables smart formatting"
    assert "api.deepgram.com" in plugin_src, "Connects to Deepgram endpoint"
    assert "getenv" in plugin_src, "Reads API key from environment (not hardcoded)"
    assert "obs_module_load" in plugin_src, "Defines obs_module_load entry point"
    assert "obs_module_unload" in plugin_src, "Defines obs_module_unload cleanup"
    assert "CloseStream" in plugin_src, "Sends CloseStream on shutdown"
    assert "audio_capture_cb" in plugin_src, "Registers audio capture callback"
    assert "obs_source_add_audio_capture_callback" in plugin_src, \
        "Uses OBS audio capture API"


def test_cmakelists():
    cmake_src = (SRC / "CMakeLists.txt").read_text()

    assert "libwebsockets" in cmake_src, "CMake fetches libwebsockets"
    assert "libobs" in cmake_src.lower() or "OBS" in cmake_src, \
        "CMake references OBS SDK"
    assert "MODULE" in cmake_src, "Builds as MODULE (shared plugin library)"
    assert "pthread" in cmake_src, "Links pthread for thread safety"


def test_deepgram_websocket_integration():
    import websocket

    api_key = os.environ["DEEPGRAM_API_KEY"]

    DG_URL = (
        "wss://api.deepgram.com/v1/listen?"
        "model=nova-3&"
        "encoding=linear16&"
        "sample_rate=16000&"
        "channels=1&"
        "interim_results=true&"
        "smart_format=true&"
        "tag=deepgram-examples"
    )

    ws = websocket.WebSocket()
    ws.connect(DG_URL, header=[f"Authorization: Token {api_key}"])

    SAMPLE_RATE = 16000
    DURATION_SECS = 3
    NUM_SAMPLES = SAMPLE_RATE * DURATION_SECS
    FREQ = 440

    audio_data = b""
    for i in range(NUM_SAMPLES):
        t = i / SAMPLE_RATE
        sample = int(16000 * math.sin(2 * math.pi * FREQ * t))
        audio_data += struct.pack("<h", sample)

    audio_sent_bytes = 0
    CHUNK_SIZE = 3200
    for offset in range(0, len(audio_data), CHUNK_SIZE):
        chunk = audio_data[offset:offset + CHUNK_SIZE]
        ws.send_binary(chunk)
        audio_sent_bytes += len(chunk)
        time.sleep(0.05)

    assert audio_sent_bytes > 0, \
        f"Sent {audio_sent_bytes} bytes of audio ({DURATION_SECS}s)"

    time.sleep(2)

    results = []
    while True:
        try:
            ws.settimeout(1.0)
            msg = ws.recv()
            if msg:
                data = json.loads(msg)
                if data.get("type") == "Results":
                    results.append(data)
        except websocket.WebSocketTimeoutException:
            break
        except Exception:
            break

    ws.send('{"type":"CloseStream"}')
    time.sleep(0.5)

    while True:
        try:
            ws.settimeout(1.0)
            msg = ws.recv()
            if msg:
                data = json.loads(msg)
                if data.get("type") == "Results":
                    results.append(data)
        except Exception:
            break

    ws.close()

    assert len(results) > 0, f"Received {len(results)} result message(s) from Deepgram"

    has_metadata = any("metadata" in r for r in results)
    assert has_metadata, "Response includes metadata"

    has_channel = any("channel" in r for r in results)
    assert has_channel, "Response includes channel data"

    for r in results:
        if "channel" in r:
            alt = r["channel"]["alternatives"][0]
            assert "transcript" in alt, "Alternative contains transcript field"
            assert "confidence" in alt, "Alternative contains confidence field"
            break
