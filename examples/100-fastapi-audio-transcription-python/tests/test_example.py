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
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from main import app


def test_deepgram_stt_direct():
    """Verify the Deepgram API key works and nova-3 returns a transcript."""
    client = DeepgramClient()
    response = client.listen.v1.media.transcribe_url(
        url="https://dpgr.am/spacewalk.wav",
        model="nova-3",
        smart_format=True,
    )
    transcript = response.results.channels[0].alternatives[0].transcript
    assert len(transcript) > 10, "Transcript too short"

    lower = transcript.lower()
    expected = ["spacewalk", "astronaut", "nasa"]
    found = [w for w in expected if w in lower]
    assert len(found) > 0, f"Expected keywords not found in: {transcript[:200]}"

    print("✓ Deepgram STT integration working")
    print(f"  Transcript preview: '{transcript[:80]}...'")


def test_transcribe_url_endpoint():
    """Verify the /transcribe-url endpoint returns a transcript."""
    client = TestClient(app)
    resp = client.post(
        "/transcribe-url",
        json={"url": "https://dpgr.am/spacewalk.wav"},
    )
    assert resp.status_code == 200, f"Unexpected status: {resp.status_code} — {resp.text}"
    data = resp.json()

    assert "transcript" in data, "Missing transcript in response"
    assert len(data["transcript"]) > 10, "Transcript too short"
    assert data["confidence"] > 0.5, f"Confidence too low: {data['confidence']}"
    assert data["duration_seconds"] > 0, "Duration should be positive"

    print("✓ /transcribe-url endpoint working")
    print(f"  Transcript preview: '{data['transcript'][:80]}...'")


def test_health_endpoint():
    """Verify the /health endpoint responds."""
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"
    print("✓ /health endpoint working")


if __name__ == "__main__":
    test_deepgram_stt_direct()
    test_transcribe_url_endpoint()
    test_health_endpoint()
