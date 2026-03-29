import os
import re
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
from deepgram_captions import DeepgramConverter, srt, webvtt

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from caption import generate_captions, transcribe_url


SAMPLE_URL = "https://dpgr.am/spacewalk.wav"


def test_transcribe_and_generate_srt():
    """Transcribe a sample audio URL and verify the SRT output is valid."""
    client = DeepgramClient()
    dg_response = transcribe_url(client, SAMPLE_URL)

    transcript = dg_response["results"]["channels"][0]["alternatives"][0]["transcript"]
    assert len(transcript) > 10, f"Transcript too short: '{transcript}'"

    srt_output = generate_captions(dg_response, fmt="srt")
    # SRT files must contain numbered subtitle blocks with timestamps
    # Format: "1\n00:00:00,000 --> 00:00:02,500\nSubtitle text\n"
    assert "-->" in srt_output, "SRT output missing timestamp arrows"
    assert re.search(r"\d{2}:\d{2}:\d{2},\d{3}", srt_output), "SRT output missing valid timestamps"
    lines = [l for l in srt_output.strip().split("\n") if l.strip()]
    assert len(lines) >= 3, f"SRT output too short: {len(lines)} lines"

    print("✓ SRT generation working")
    print(f"  SRT preview (first 200 chars): '{srt_output[:200]}...'")


def test_generate_vtt():
    """Transcribe and verify WebVTT output format."""
    client = DeepgramClient()
    dg_response = transcribe_url(client, SAMPLE_URL)

    vtt_output = generate_captions(dg_response, fmt="vtt")
    # WebVTT files must start with "WEBVTT" header
    assert vtt_output.strip().startswith("WEBVTT"), "VTT output missing WEBVTT header"
    assert "-->" in vtt_output, "VTT output missing timestamp arrows"
    # VTT uses period for milliseconds (00:00:00.000) unlike SRT's comma
    assert re.search(r"\d{2}:\d{2}:\d{2}\.\d{3}", vtt_output), "VTT output missing valid timestamps"

    print("✓ VTT generation working")
    print(f"  VTT preview (first 200 chars): '{vtt_output[:200]}...'")


def test_diarize_option():
    """Verify that diarization produces speaker-labelled output."""
    client = DeepgramClient()
    dg_response = transcribe_url(client, SAMPLE_URL, diarize=True)

    # With diarize=True, the response should contain speaker info in words
    words = dg_response["results"]["channels"][0]["alternatives"][0].get("words", [])
    if words:
        has_speaker = any("speaker" in w for w in words)
        assert has_speaker, "Diarize was requested but no speaker labels in response"
        print("✓ Diarization working — speaker labels present")
    else:
        print("✓ Diarization requested (no words to verify — transcript may be too short)")


if __name__ == "__main__":
    test_transcribe_and_generate_srt()
    test_generate_vtt()
    test_diarize_option()
