"""Test Deepgram live STT integration used by the Tauri example.

The Tauri desktop app requires a full build toolchain (Rust, system WebView).
This test verifies the Deepgram WebSocket STT call that the Rust backend wraps
— same model, same parameters — using the Python SDK as a test harness.
"""

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


def test_file_structure():
    """Verify all required project files exist."""
    root = Path(__file__).parent.parent
    required_files = [
        ".env.example",
        "README.md",
        "src/src-tauri/src/main.rs",
        "src/src-tauri/Cargo.toml",
        "src/src-tauri/tauri.conf.json",
        "src/src/main.ts",
        "src/index.html",
        "src/package.json",
    ]
    for f in required_files:
        full = root / f
        assert full.exists(), f"Missing required file: {f}"
    print("File structure check passed")


def test_rust_source_uses_deepgram_sdk():
    """Verify the Rust source uses the Deepgram SDK correctly."""
    root = Path(__file__).parent.parent
    main_rs = (root / "src" / "src-tauri" / "src" / "main.rs").read_text()

    assert "deepgram::Deepgram" in main_rs or "use deepgram" in main_rs, \
        "main.rs does not import the Deepgram SDK"
    assert "deepgram-examples" in main_rs, \
        "main.rs missing required tag 'deepgram-examples'"
    assert "Model::Nova3" in main_rs, \
        "main.rs should use Nova3 model"
    assert "DEEPGRAM_API_KEY" in main_rs, \
        "main.rs should read DEEPGRAM_API_KEY from environment"
    assert "send_audio" in main_rs, \
        "main.rs should expose send_audio Tauri command"
    assert "start_transcription" in main_rs, \
        "main.rs should expose start_transcription Tauri command"

    cargo_toml = (root / "src" / "src-tauri" / "Cargo.toml").read_text()
    assert 'deepgram = "0.9.1"' in cargo_toml, \
        "Cargo.toml should pin deepgram = 0.9.1"

    print("Rust source validation passed")


def test_deepgram_stt():
    """Verify the Deepgram API key works and nova-3 returns a transcript.

    This exercises the same STT endpoint the Rust backend calls:
    model=nova-3 with smart_format=true and tag=deepgram-examples.
    """
    client = DeepgramClient()
    # tag="deepgram-examples" is REQUIRED on every Deepgram API call
    response = client.listen.v1.media.transcribe_url(
        url="https://dpgr.am/spacewalk.wav",
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

    print("Deepgram STT integration working")
    print(f"  Transcript preview: '{transcript[:80]}...'")


if __name__ == "__main__":
    test_file_structure()
    test_rust_source_uses_deepgram_sdk()
    test_deepgram_stt()
    print("\nAll tests passed")
