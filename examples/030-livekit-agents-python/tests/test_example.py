import os
import sys
from pathlib import Path

# ── Credential check ────────────────────────────────────────────────────────
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

# We can't run the full LiveKit agent in CI (it needs a running LiveKit server
# and a real room), but we CAN verify:
#   1. Deepgram API key works for STT
#   2. The agent module imports cleanly (no syntax errors, missing deps)

from deepgram import DeepgramClient


def test_deepgram_stt():
    client = DeepgramClient()
    response = client.listen.v1.media.transcribe_url(
        url="https://dpgr.am/spacewalk.wav",
        model="nova-3",
        smart_format=True,
        tag="deepgram-examples",
    )
    transcript = response.results.channels[0].alternatives[0].transcript
    assert len(transcript) > 10, "Transcript too short"
    print("✓ Deepgram STT integration working")
    print(f"  Transcript preview: '{transcript[:80]}...'")


def test_agent_module_imports():
    # Importing the agent module verifies that all dependencies are installed
    # and the code is syntactically valid.
    sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
    import agent  # noqa: F401

    print("✓ Agent module imports correctly")


if __name__ == "__main__":
    test_deepgram_stt()
    test_agent_module_imports()
