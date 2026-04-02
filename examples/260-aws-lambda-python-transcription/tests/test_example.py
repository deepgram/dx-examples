import json
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

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from handler import handler


SAMPLE_AUDIO_URL = "https://dpgr.am/spacewalk.wav"


def test_deepgram_stt_direct():
    """Verify the Deepgram API key works and nova-3 returns a transcript."""
    from deepgram import DeepgramClient

    client = DeepgramClient()
    response = client.listen.v1.media.transcribe_url(
        url=SAMPLE_AUDIO_URL,
        model="nova-3",
        smart_format=True,
        tag="deepgram-examples",
    )
    transcript = response.results.channels[0].alternatives[0].transcript
    assert len(transcript) > 10, "Transcript too short"

    lower = transcript.lower()
    expected = ["spacewalk", "astronaut", "nasa"]
    found = [w for w in expected if w in lower]
    assert len(found) > 0, f"Expected keywords not found in: {transcript[:200]}"

    print("  Deepgram STT integration working")
    print(f"  Transcript preview: '{transcript[:80]}...'")


def test_lambda_handler_url():
    """Verify the Lambda handler transcribes from a URL."""
    event = {
        "body": json.dumps({"url": SAMPLE_AUDIO_URL}),
        "isBase64Encoded": False,
    }
    result = handler(event, None)

    assert result["statusCode"] == 200, f"Unexpected status: {result['statusCode']} — {result['body']}"
    data = json.loads(result["body"])

    assert "transcript" in data, "Missing transcript in response"
    assert len(data["transcript"]) > 10, "Transcript too short"
    assert data["confidence"] > 0.5, f"Confidence too low: {data['confidence']}"
    assert data["duration_seconds"] > 0, "Duration should be positive"
    assert data["words_count"] > 0, "Should have words"

    print("  Lambda handler (URL mode) working")
    print(f"  Transcript preview: '{data['transcript'][:80]}...'")


def test_lambda_handler_empty_body():
    """Verify the handler returns 400 for an empty body."""
    event = {"body": "", "isBase64Encoded": False}
    result = handler(event, None)
    assert result["statusCode"] == 400
    print("  Lambda handler rejects empty body correctly")


def test_lambda_handler_invalid_json():
    """Verify the handler returns 400 for invalid JSON."""
    event = {"body": "not json", "isBase64Encoded": False}
    result = handler(event, None)
    assert result["statusCode"] == 400
    print("  Lambda handler rejects invalid JSON correctly")


if __name__ == "__main__":
    test_deepgram_stt_direct()
    test_lambda_handler_url()
    test_lambda_handler_empty_body()
    test_lambda_handler_invalid_json()
    print("\nAll tests passed")
