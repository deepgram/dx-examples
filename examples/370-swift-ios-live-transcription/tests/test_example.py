"""Test Deepgram live STT integration used by the Swift iOS example.

The SwiftUI app itself requires an iOS device/simulator with a microphone.
This test verifies the Deepgram WebSocket and REST endpoints that the Swift
client wraps — same API, same parameters — using the Python SDK as a
convenient test harness.
"""

import os
import sys
from pathlib import Path

# ── Credential check ────────────────────────────────────────────────────────
# Exit code convention across all examples in this repo:
#   0 = all tests passed
#   1 = real test failure (code bug, assertion error, unexpected API response)
#   2 = missing credentials (expected in CI until secrets are configured)
env_example = Path(__file__).parent.parent / ".env.example"
required = [
    line.split("=")[0].strip()
    for line in env_example.read_text().splitlines()
    if line and not line.startswith("#") and "=" in line and line[0].isupper()
]
missing = [k for k in required if not os.environ.get(k)]
if missing:
    print(f"MISSING_CREDENTIALS: {','.join(missing)}", file=sys.stderr)
    sys.exit(2)
# ────────────────────────────────────────────────────────────────────────────

from deepgram import DeepgramClient


def test_deepgram_live_stt():
    """Verify the Deepgram API key works and nova-3 returns a transcript.

    This exercises the same REST pre-recorded endpoint with the same model
    (nova-3) the Swift app uses for live streaming. If pre-recorded works,
    the live WebSocket will too — both use the same API key and model.
    """
    client = DeepgramClient()
    response = client.listen.v1.media.transcribe_url(
        url="https://dpgr.am/spacewalk.wav",
        model="nova-3",
        smart_format=True,
        tag="deepgram-examples",
    )
    transcript = response.results.channels[0].alternatives[0].transcript
    assert len(transcript) > 10, f"Transcript too short: '{transcript}'"

    lower = transcript.lower()
    expected = ["spacewalk", "astronaut", "nasa"]
    found = [w for w in expected if w in lower]
    assert len(found) > 0, f"Expected keywords not found in: {transcript[:200]}"

    print("✓ Deepgram STT integration working (validates API key + nova-3 model)")
    print(f"  Transcript preview: '{transcript[:80]}...'")


def test_deepgram_live_websocket():
    """Verify the WebSocket live endpoint accepts our connection and returns results.

    This mirrors the Swift app's URLSessionWebSocketTask connection to
    wss://api.deepgram.com/v1/listen with the same query parameters.
    """
    import json
    import threading
    import websocket

    api_key = os.environ["DEEPGRAM_API_KEY"]
    url = (
        "wss://api.deepgram.com/v1/listen"
        "?model=nova-3&encoding=linear16&sample_rate=16000"
        "&channels=1&interim_results=true&utterance_end_ms=1000"
        "&tag=deepgram-examples"
    )

    results = []
    connected = threading.Event()
    done = threading.Event()

    def on_open(ws):
        connected.set()
        # Send a small silent audio buffer then close
        # 16000 Hz * 2 bytes * 0.5s = 16000 bytes of silence
        silence = b"\x00" * 16000
        ws.send(silence, opcode=websocket.ABNF.OPCODE_BINARY)
        ws.send(json.dumps({"type": "CloseStream"}))

    def on_message(ws, message):
        data = json.loads(message)
        results.append(data)
        if data.get("type") == "Metadata" or data.get("type") == "Results":
            pass
        if data.get("type") == "Finalize":
            done.set()

    def on_close(ws, close_status, close_msg):
        done.set()

    def on_error(ws, error):
        results.append({"error": str(error)})
        done.set()

    ws = websocket.WebSocketApp(
        url,
        header={"Authorization": f"Token {api_key}"},
        on_open=on_open,
        on_message=on_message,
        on_close=on_close,
        on_error=on_error,
    )

    thread = threading.Thread(target=ws.run_forever, daemon=True)
    thread.start()

    connected.wait(timeout=10)
    assert connected.is_set(), "WebSocket failed to connect within 10s"

    done.wait(timeout=15)

    errors = [r for r in results if "error" in r]
    assert not errors, f"WebSocket errors: {errors}"

    has_results = any(r.get("type") in ("Results", "Metadata") for r in results)
    assert has_results, f"No Results/Metadata messages received. Got: {[r.get('type') for r in results]}"

    print("✓ Deepgram WebSocket live STT connection working")
    print(f"  Received {len(results)} message(s)")


if __name__ == "__main__":
    test_deepgram_live_stt()
    test_deepgram_live_websocket()
