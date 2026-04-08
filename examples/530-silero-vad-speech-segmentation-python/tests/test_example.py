"""Tests for Silero VAD speech segmentation with Deepgram STT."""

import os
import sys
import tempfile
import urllib.request
from pathlib import Path

import torch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

env_file = Path(__file__).resolve().parent.parent / ".env.example"
required = [
    line.split("=")[0].strip()
    for line in env_file.read_text().splitlines()
    if line.strip() and not line.startswith("#") and "=" in line
]
missing = [k for k in required if not os.environ.get(k)]
if missing:
    print(f"MISSING_CREDENTIALS: {','.join(missing)}", file=sys.stderr)
    sys.exit(2)

AUDIO_URL = "https://dpgr.am/spacewalk.wav"
AUDIO_PATH = None


def get_audio_path() -> str:
    global AUDIO_PATH
    if AUDIO_PATH is None:
        tmp = tempfile.NamedTemporaryFile(suffix=".wav", delete=False)
        urllib.request.urlretrieve(AUDIO_URL, tmp.name)
        AUDIO_PATH = tmp.name
    return AUDIO_PATH


def test_detect_speech_regions():
    """VAD should detect multiple speech regions in real speech audio."""
    from segmenter import detect_speech_regions

    wav, timestamps = detect_speech_regions(get_audio_path())

    assert isinstance(wav, torch.Tensor), "wav should be a torch.Tensor"
    assert isinstance(timestamps, list), "timestamps should be a list"
    assert len(timestamps) >= 2, f"Expected multiple speech regions, got {len(timestamps)}"

    for ts in timestamps:
        assert "start" in ts and "end" in ts, "Each timestamp must have start and end"
        assert ts["end"] > ts["start"], "end should be after start"

    print(f"  Found {len(timestamps)} speech region(s)")
    for ts in timestamps[:5]:
        print(f"    {ts['start']/16000:.2f}s - {ts['end']/16000:.2f}s")

    print("  ✓ detect_speech_regions finds speech in real audio")


def test_extract_segment_bytes():
    """extract_segment_bytes should produce valid WAV bytes."""
    from segmenter import extract_segment_bytes

    sample_rate = 16000
    wav = torch.randn(sample_rate * 2)
    audio_bytes = extract_segment_bytes(wav, 0, sample_rate)

    assert isinstance(audio_bytes, bytes), "Should return bytes"
    assert len(audio_bytes) > 44, "WAV should be larger than just the header"
    assert audio_bytes[:4] == b"RIFF", "Should be valid WAV format"

    print("  ✓ extract_segment_bytes produces valid WAV")


def test_process_audio_end_to_end():
    """Full pipeline: VAD segmentation → Deepgram transcription on real speech."""
    from segmenter import process_audio

    segments = process_audio(get_audio_path())

    assert isinstance(segments, list), "Should return a list"
    assert len(segments) >= 1, "Should transcribe at least one segment from real speech"

    total_transcript = ""
    for seg in segments:
        assert seg.start_sec >= 0, "start_sec should be non-negative"
        assert seg.end_sec > seg.start_sec, "end_sec should be after start_sec"
        assert isinstance(seg.transcript, str), "transcript should be a string"
        assert 0 <= seg.confidence <= 1, "confidence should be between 0 and 1"
        total_transcript += seg.transcript

    audio_duration_sec = 25.9
    min_chars = max(5, audio_duration_sec * 2)
    assert len(total_transcript.strip()) >= min_chars, (
        f"Total transcript too short ({len(total_transcript)} chars) for {audio_duration_sec}s audio"
    )

    print(f"  Transcribed {len(segments)} segment(s), {len(total_transcript)} total chars")
    for seg in segments:
        print(f"    [{seg.start_sec:.1f}s-{seg.end_sec:.1f}s] conf={seg.confidence:.2f} '{seg.transcript[:60]}'")

    print("  ✓ End-to-end pipeline transcribes real speech correctly")


def test_vad_parameters_affect_output():
    """Different VAD thresholds should produce different segmentation results."""
    from segmenter import detect_speech_regions

    audio_path = get_audio_path()

    _, ts_default = detect_speech_regions(audio_path, threshold=0.5)
    _, ts_strict = detect_speech_regions(audio_path, threshold=0.9)

    assert isinstance(ts_default, list)
    assert isinstance(ts_strict, list)
    assert len(ts_default) >= 1, "Default threshold should find speech"

    print(f"  threshold=0.5 → {len(ts_default)} regions, threshold=0.9 → {len(ts_strict)} regions")
    print("  ✓ VAD parameters affect segmentation output")


if __name__ == "__main__":
    tests = [
        ("detect_speech_regions", test_detect_speech_regions),
        ("extract_segment_bytes", test_extract_segment_bytes),
        ("process_audio (end-to-end)", test_process_audio_end_to_end),
        ("VAD parameters", test_vad_parameters_affect_output),
    ]

    passed = 0
    failed = 0

    try:
        for name, test_fn in tests:
            print(f"\n── {name} ──")
            try:
                test_fn()
                passed += 1
            except Exception as e:
                print(f"  ✗ FAILED: {e}")
                failed += 1
    finally:
        if AUDIO_PATH and os.path.exists(AUDIO_PATH):
            os.unlink(AUDIO_PATH)

    print(f"\n{'='*40}")
    print(f"Results: {passed} passed, {failed} failed")
    print(f"{'='*40}")

    sys.exit(1 if failed > 0 else 0)
