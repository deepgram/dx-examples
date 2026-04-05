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

errors = []


def check(condition, msg):
    if not condition:
        errors.append(msg)
        print(f"FAIL: {msg}", file=sys.stderr)
    else:
        print(f"  OK: {msg}")


# ── 1. File structure ────────────────────────────────────────────────────
print("== File structure ==")

required_files = [
    ".env.example",
    "README.md",
    "src/deepgram-caption-plugin.c",
    "src/CMakeLists.txt",
]
for f in required_files:
    check((ROOT / f).exists(), f"Required file exists: {f}")


# ── 2. Source code validation ────────────────────────────────────────────
print("\n== Source code patterns ==")

plugin_src = (SRC / "deepgram-caption-plugin.c").read_text()

check("nova-3" in plugin_src, "Uses nova-3 model")
check("deepgram-examples" in plugin_src, "Includes deepgram-examples tag")
check("linear16" in plugin_src, "Uses linear16 encoding")
check("sample_rate=16000" in plugin_src, "Uses 16 kHz sample rate")
check("interim_results=true" in plugin_src, "Enables interim results")
check("smart_format=true" in plugin_src, "Enables smart formatting")
check("api.deepgram.com" in plugin_src, "Connects to Deepgram endpoint")
check("getenv" in plugin_src, "Reads API key from environment (not hardcoded)")
check("obs_module_load" in plugin_src, "Defines obs_module_load entry point")
check("obs_module_unload" in plugin_src, "Defines obs_module_unload cleanup")
check("CloseStream" in plugin_src, "Sends CloseStream on shutdown")
check("audio_capture_cb" in plugin_src, "Registers audio capture callback")
check("obs_source_add_audio_capture_callback" in plugin_src,
      "Uses OBS audio capture API")

# ── 3. CMakeLists validation ─────────────────────────────────────────────
print("\n== CMakeLists.txt ==")

cmake_src = (SRC / "CMakeLists.txt").read_text()

check("libwebsockets" in cmake_src, "CMake fetches libwebsockets")
check("libobs" in cmake_src.lower() or "OBS" in cmake_src,
      "CMake references OBS SDK")
check("MODULE" in cmake_src, "Builds as MODULE (shared plugin library)")
check("pthread" in cmake_src, "Links pthread for thread safety")


# ── 4. Deepgram WebSocket integration test ───────────────────────────────
print("\n== Deepgram WebSocket integration ==")

try:
    import websocket
except ImportError:
    import subprocess
    subprocess.check_call([sys.executable, "-m", "pip", "install",
                           "websocket-client", "-q"])
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

transcript_parts = []
ws_opened = [False]
ws_error = [None]
ws_closed = [False]
audio_sent_bytes = [0]

def on_open(ws):
    ws_opened[0] = True

def on_message(ws, message):
    try:
        data = json.loads(message)
        if data.get("type") == "Results":
            alt = data["channel"]["alternatives"][0]
            t = alt.get("transcript", "")
            if t:
                transcript_parts.append(t)
    except Exception:
        pass

def on_error(ws, error):
    ws_error[0] = str(error)

def on_close(ws, close_status, close_msg):
    ws_closed[0] = True


ws = websocket.WebSocket()
ws.connect(DG_URL, header=[f"Authorization: Token {api_key}"])
check(True, "WebSocket connection established to Deepgram")

SAMPLE_RATE = 16000
DURATION_SECS = 3
NUM_SAMPLES = SAMPLE_RATE * DURATION_SECS
FREQ = 440

import math
audio_data = b""
for i in range(NUM_SAMPLES):
    t = i / SAMPLE_RATE
    sample = int(16000 * math.sin(2 * math.pi * FREQ * t))
    audio_data += struct.pack("<h", sample)

CHUNK_SIZE = 3200
for offset in range(0, len(audio_data), CHUNK_SIZE):
    chunk = audio_data[offset:offset + CHUNK_SIZE]
    ws.send_binary(chunk)
    audio_sent_bytes[0] += len(chunk)
    time.sleep(0.05)

check(audio_sent_bytes[0] > 0,
      f"Sent {audio_sent_bytes[0]} bytes of audio ({DURATION_SECS}s)")

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

check(len(results) > 0, f"Received {len(results)} result message(s) from Deepgram")

if results:
    has_metadata = any("metadata" in r for r in results)
    check(has_metadata, "Response includes metadata")

    has_channel = any("channel" in r for r in results)
    check(has_channel, "Response includes channel data")

    if has_channel:
        for r in results:
            if "channel" in r:
                alt = r["channel"]["alternatives"][0]
                check("transcript" in alt, "Alternative contains transcript field")
                check("confidence" in alt, "Alternative contains confidence field")
                break


# ── Summary ──────────────────────────────────────────────────────────────
print(f"\n{'='*60}")
if errors:
    print(f"FAILED: {len(errors)} check(s) failed")
    for e in errors:
        print(f"  - {e}")
    sys.exit(1)
else:
    print("ALL CHECKS PASSED")
    sys.exit(0)
