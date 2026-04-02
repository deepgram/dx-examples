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

AUDIO_URL = "https://dpgr.am/spacewalk.wav"


def test_deepgram_stt():
    """Verify Deepgram STT transcribes audio correctly with nova-3."""
    client = DeepgramClient()
    response = client.listen.v1.media.transcribe_url(
        url=AUDIO_URL,
        model="nova-3",
        smart_format=True,
        tag="deepgram-examples",
    )
    transcript = response.results.channels[0].alternatives[0].transcript
    assert len(transcript) > 10, "Transcript too short"

    duration = response.results.channels[0].alternatives[0].words[-1].end if response.results.channels[0].alternatives[0].words else 0
    chars_per_sec = len(transcript) / max(duration, 1)
    assert 1 < chars_per_sec < 100, f"Transcript length not proportional to duration: {len(transcript)} chars / {duration:.1f}s"

    print("pass: Deepgram STT integration working")
    print(f"  Transcript preview: '{transcript[:80]}...'")


def test_deepgram_tts():
    """Verify Deepgram TTS generates audio bytes."""
    client = DeepgramClient()
    import tempfile

    output_path = os.path.join(tempfile.gettempdir(), "test_tts_output.wav")
    audio_iter = client.speak.v1.audio.generate(
        text="Hello, this is a test of Deepgram text to speech.",
        model="aura-2-asteria-en",
        encoding="linear16",
        sample_rate=24000,
        container="wav",
        tag="deepgram-examples",
    )

    with open(output_path, "wb") as f:
        for chunk in audio_iter:
            f.write(chunk)

    assert os.path.exists(output_path), "TTS output file was not created"
    file_size = os.path.getsize(output_path)
    assert file_size > 1000, f"TTS output too small ({file_size} bytes)"

    os.unlink(output_path)
    print("pass: Deepgram TTS integration working")
    print(f"  Generated {file_size} bytes of audio")


def test_crewai_tools_importable():
    """Verify the CrewAI tools from our source are importable and well-formed."""
    sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
    from crew import transcribe_audio, speak_text

    assert transcribe_audio.name == "transcribe_audio"
    assert "transcribe" in transcribe_audio.description.lower()

    assert speak_text.name == "speak_text"
    assert "speech" in speak_text.description.lower() or "text" in speak_text.description.lower()

    print("pass: CrewAI tool definitions valid")
    print(f"  Tools: {transcribe_audio.name}, {speak_text.name}")


def test_crewai_crew_builds():
    """Verify the crew can be assembled without errors."""
    sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
    from crew import build_crew

    crew = build_crew(AUDIO_URL)
    assert len(crew.agents) == 3, f"Expected 3 agents, got {len(crew.agents)}"
    assert len(crew.tasks) == 3, f"Expected 3 tasks, got {len(crew.tasks)}"

    roles = [a.role for a in crew.agents]
    assert "Voice Listener" in roles
    assert "Research Analyst" in roles
    assert "Voice Speaker" in roles

    print("pass: CrewAI crew builds correctly")
    print(f"  Agents: {', '.join(roles)}")


if __name__ == "__main__":
    test_deepgram_stt()
    test_deepgram_tts()
    test_crewai_tools_importable()
    test_crewai_crew_builds()
