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

    print("✓ Deepgram STT integration working")
    print(f"  Transcript preview: '{transcript[:80]}...'")


def test_langchain_tool_schema():
    """Verify the LangChain tool is correctly defined and has the expected schema."""
    sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
    from transcribe_tool import transcribe_audio

    assert transcribe_audio.name == "transcribe_audio"
    assert "audio" in transcribe_audio.description.lower()

    schema = transcribe_audio.args_schema.model_json_schema()
    assert "audio_url" in schema.get("properties", {}), "Missing audio_url in tool schema"

    print("✓ LangChain tool schema valid")
    print(f"  Tool name: {transcribe_audio.name}")


def test_tool_invocation():
    """Call the tool directly (no agent) to verify end-to-end transcription."""
    sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
    from transcribe_tool import transcribe_audio

    result = transcribe_audio.invoke("https://dpgr.am/spacewalk.wav")
    assert "transcript" in result.lower() or len(result) > 50, f"Unexpected tool output: {result[:200]}"
    assert "error" not in result.lower(), f"Tool returned error: {result}"

    print("✓ Tool invocation working")
    print(f"  Output preview: '{result[:100]}...'")


if __name__ == "__main__":
    test_deepgram_stt()
    test_langchain_tool_schema()
    test_tool_invocation()
