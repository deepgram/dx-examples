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


def test_deepgram_tts():
    """Verify Deepgram TTS generates audio bytes."""
    client = DeepgramClient()
    audio_chunks = list(client.speak.v1.audio.generate(
        text="Hello, this is a test of Deepgram text to speech.",
        model="aura-2-asteria-en",
        encoding="linear16",
        sample_rate=24000,
    ))
    total_bytes = sum(len(c) for c in audio_chunks)
    assert total_bytes > 1000, f"TTS audio too small: {total_bytes} bytes"

    print("  Deepgram TTS integration working")
    print(f"  Generated {total_bytes} bytes of audio")


def test_openai_agents_imports():
    """Verify OpenAI Agents SDK voice components are importable."""
    from agents import Agent
    from agents.voice import (
        AudioInput,
        SingleAgentVoiceWorkflow,
        STTModel,
        TTSModel,
        VoiceModelProvider,
        VoicePipeline,
        VoicePipelineConfig,
    )

    assert Agent is not None
    assert VoicePipeline is not None
    assert STTModel is not None
    assert TTSModel is not None
    assert VoiceModelProvider is not None

    print("  OpenAI Agents SDK voice imports working")


def test_agent_module_imports():
    """Verify the agent source module imports without errors."""
    sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
    import agent  # noqa: F401

    print("  Agent module imports correctly")


def test_custom_provider_instantiation():
    """Verify our custom Deepgram provider creates STT and TTS models."""
    sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
    from agent import DeepgramSTTModel, DeepgramTTSModel, DeepgramVoiceProvider

    provider = DeepgramVoiceProvider()
    stt = provider.get_stt_model(None)
    tts = provider.get_tts_model(None)

    assert isinstance(stt, DeepgramSTTModel)
    assert isinstance(tts, DeepgramTTSModel)
    assert stt.model_name == "deepgram-nova-3"
    assert tts.model_name == "deepgram-aura-2"

    print("  Custom Deepgram provider instantiation working")


if __name__ == "__main__":
    test_deepgram_stt()
    test_deepgram_tts()
    test_openai_agents_imports()
    test_agent_module_imports()
    test_custom_provider_instantiation()
    print("\nAll tests passed")
