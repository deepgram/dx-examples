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


def test_deepgram_stt():
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

    print("  Deepgram STT integration working")
    print(f"  Transcript preview: '{transcript[:80]}...'")


def test_django_imports():
    """Verify Django and Channels are importable and configured."""
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "settings")
    sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

    import django

    django.setup()

    from django.conf import settings

    assert settings.ASGI_APPLICATION == "asgi.application"
    assert "daphne" in settings.INSTALLED_APPS

    print("  Django settings configured correctly")


def test_consumer_imports():
    """Verify the transcription consumer is importable."""
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "settings")
    sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

    import django

    django.setup()

    from consumer import TranscriptionConsumer

    assert TranscriptionConsumer is not None
    assert hasattr(TranscriptionConsumer, "connect")
    assert hasattr(TranscriptionConsumer, "disconnect")
    assert hasattr(TranscriptionConsumer, "receive")

    print("  TranscriptionConsumer imports correctly")


def test_template_exists():
    """Verify the HTML template is present."""
    template = Path(__file__).parent.parent / "src" / "templates" / "index.html"
    assert template.exists(), "index.html template missing"
    content = template.read_text()
    assert "getUserMedia" in content, "Template should use getUserMedia for microphone"
    assert "ws/transcribe" in content, "Template should connect to ws/transcribe endpoint"

    print("  Template exists and contains expected content")


if __name__ == "__main__":
    test_deepgram_stt()
    test_django_imports()
    test_consumer_imports()
    test_template_exists()
    print("\nAll tests passed")
