import json
import os
import struct
import subprocess
import sys
import threading
import time
from pathlib import Path

# -- Credential check -------------------------------------------------------
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
# ---------------------------------------------------------------------------

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from fastapi.testclient import TestClient
from server import create_app

AUDIO_URL = "https://static.deepgram.com/examples/Bueller-Life-moves-pretty-fast.wav"
TEST_PORT = 3097

app = create_app()
client = TestClient(app)


def test_health_endpoint():
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "deepgram-proxy"
    print("/health -> ok")


def test_listen_validation():
    resp = client.post("/v1/listen", json={})
    assert resp.status_code == 422, f"Expected 422 for missing url, got {resp.status_code}"
    print("/v1/listen validation -> 422 for missing url")


def test_listen_prerecorded():
    resp = client.post(
        "/v1/listen",
        json={"url": AUDIO_URL, "smart_format": True},
    )
    assert resp.status_code == 200, f"/v1/listen returned {resp.status_code}: {resp.text}"
    data = resp.json()

    transcript = data["results"]["channels"][0]["alternatives"][0]["transcript"]
    assert len(transcript) >= 20, (
        f"Transcript too short: {len(transcript)} chars, expected >= 20"
    )
    print(f"/v1/listen -> {len(transcript)} chars")
    print(f"  Preview: '{transcript[:80]}...'")


def test_speak_validation():
    resp = client.post("/v1/speak", json={})
    assert resp.status_code == 422, f"Expected 422 for missing text, got {resp.status_code}"
    print("/v1/speak validation -> 422 for missing text")


def test_speak_tts():
    resp = client.post(
        "/v1/speak",
        json={"text": "Hello from the Deepgram proxy test."},
    )
    assert resp.status_code == 200, f"/v1/speak returned {resp.status_code}: {resp.text}"
    assert resp.headers.get("content-type", "").startswith("audio/")
    audio_bytes = resp.content
    assert len(audio_bytes) > 100, f"TTS audio too small: {len(audio_bytes)} bytes"
    print(f"/v1/speak -> {len(audio_bytes)} bytes of audio")


def test_websocket_live_stt():
    tmp_wav = Path("/tmp/proxy_test_521.wav")
    if not tmp_wav.exists():
        print("Downloading test audio...")
        subprocess.run(
            ["curl", "-s", "-L", "-o", str(tmp_wav), AUDIO_URL],
            check=True,
        )

    wav_data = tmp_wav.read_bytes()
    pcm_data = _wav_to_linear16_16k(wav_data)
    print(f"Audio ready: {len(pcm_data)} bytes of linear16 16kHz")

    import uvicorn
    import websockets.sync.client as ws_sync

    server_ready = threading.Event()

    def run_server():
        config = uvicorn.Config(app, host="127.0.0.1", port=TEST_PORT, log_level="warning")
        server = uvicorn.Server(config)
        server_ready.server_instance = server
        server_ready.set()
        server.run()

    thread = threading.Thread(target=run_server, daemon=True)
    thread.start()
    server_ready.wait(timeout=5)
    time.sleep(1)

    transcripts = []
    chunk_size = 3200
    max_bytes = 16000 * 2 * 30

    try:
        with ws_sync.connect(f"ws://127.0.0.1:{TEST_PORT}/v1/listen/stream") as ws:
            ws.recv_bufsize = 65536

            offset = 0
            while offset < len(pcm_data) and offset < max_bytes:
                ws.send(pcm_data[offset : offset + chunk_size])
                offset += chunk_size
                time.sleep(chunk_size / (16000 * 2))

                try:
                    ws.socket.setblocking(False)
                    try:
                        raw = ws.recv(timeout=0)
                        data = json.loads(raw)
                        text = data.get("channel", {}).get("alternatives", [{}])[0].get("transcript", "")
                        if text:
                            transcripts.append(text)
                    except Exception:
                        pass
                    finally:
                        ws.socket.setblocking(True)
                except Exception:
                    pass

            for _ in range(300):
                try:
                    raw = ws.recv(timeout=0.5)
                    data = json.loads(raw)
                    text = data.get("channel", {}).get("alternatives", [{}])[0].get("transcript", "")
                    if text:
                        transcripts.append(text)
                except TimeoutError:
                    break
                except Exception:
                    break
    finally:
        if hasattr(server_ready, "server_instance"):
            server_ready.server_instance.should_exit = True

    assert len(transcripts) > 0, "No transcripts received via WebSocket proxy"
    combined = " ".join(transcripts)
    audio_sent_secs = min(len(pcm_data), max_bytes) / (16000 * 2)
    min_chars = max(5, int(audio_sent_secs * 2))
    assert len(combined) >= min_chars, (
        f"Combined transcript too short: {len(combined)} chars for {audio_sent_secs:.1f}s audio"
    )
    print(f"WS /v1/listen/stream -> {len(transcripts)} transcript events")
    print(f"  Combined: {len(combined)} chars over {audio_sent_secs:.1f}s audio")
    print(f"  First: '{transcripts[0][:80]}'")


def _wav_to_linear16_16k(wav_data: bytes) -> bytes:
    offset = 12
    sample_rate = 0
    bits_per_sample = 0
    num_channels = 0
    data_start = 0
    data_size = 0

    while offset < len(wav_data) - 8:
        chunk_id = wav_data[offset : offset + 4].decode("ascii", errors="replace")
        chunk_size = struct.unpack_from("<I", wav_data, offset + 4)[0]
        if chunk_id == "fmt ":
            num_channels = struct.unpack_from("<H", wav_data, offset + 10)[0]
            sample_rate = struct.unpack_from("<I", wav_data, offset + 12)[0]
            bits_per_sample = struct.unpack_from("<H", wav_data, offset + 22)[0]
        elif chunk_id == "data":
            data_start = offset + 8
            data_size = chunk_size
            break
        offset += 8 + chunk_size

    if not data_start:
        raise ValueError("Invalid WAV: no data chunk")

    bytes_per_sample = bits_per_sample // 8
    total_samples = data_size // (bytes_per_sample * num_channels)
    ratio = sample_rate / 16000
    out_len = int(total_samples / ratio)
    out = bytearray(out_len * 2)

    for i in range(out_len):
        src_idx = int(i * ratio)
        byte_off = data_start + src_idx * bytes_per_sample * num_channels
        if bits_per_sample == 16:
            sample = struct.unpack_from("<h", wav_data, byte_off)[0]
        elif bits_per_sample == 24:
            b0, b1, b2 = wav_data[byte_off], wav_data[byte_off + 1], wav_data[byte_off + 2]
            sample = b0 | (b1 << 8) | (b2 << 16)
            if sample & 0x800000:
                sample |= ~0xFFFFFF
            sample = sample >> 8
        elif bits_per_sample == 32:
            sample = struct.unpack_from("<i", wav_data, byte_off)[0] >> 16
        else:
            sample = (wav_data[byte_off] - 128) << 8
        struct.pack_into("<h", out, i * 2, max(-32768, min(32767, sample)))

    return bytes(out)


if __name__ == "__main__":
    test_health_endpoint()
    test_listen_validation()
    test_speak_validation()
    test_listen_prerecorded()
    test_speak_tts()
    test_websocket_live_stt()
    print("\nAll tests passed")
