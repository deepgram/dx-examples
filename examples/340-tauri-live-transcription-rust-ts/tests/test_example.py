"""Test the Tauri desktop live transcription example.

The Tauri desktop app requires a full build toolchain (Rust, system WebView,
and a display). This test verifies the example's correctness by inspecting
source files directly — the Rust backend, Tauri configuration, and TypeScript
frontend — without building or running the app.
"""

import os
import sys
import json
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

ROOT = Path(__file__).parent.parent


def test_file_structure():
    """Verify all required project files exist."""
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
        full = ROOT / f
        assert full.exists(), f"Missing required file: {f}"
    print("File structure check passed")


def test_rust_source_uses_deepgram_sdk():
    """Verify the Rust source uses the Deepgram SDK correctly."""
    main_rs = (ROOT / "src" / "src-tauri" / "src" / "main.rs").read_text()

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

    print("Rust source validation passed")


def test_cargo_toml_pins_deepgram():
    """Verify Cargo.toml declares the deepgram crate dependency."""
    cargo_toml = (ROOT / "src" / "src-tauri" / "Cargo.toml").read_text()

    assert "deepgram" in cargo_toml, \
        "Cargo.toml must declare the deepgram crate as a dependency"
    assert "0.9.2" in cargo_toml, \
        "Cargo.toml should pin deepgram at version 0.9.2"
    assert "tauri" in cargo_toml, \
        "Cargo.toml must declare the tauri crate as a dependency"

    print("Cargo.toml declares deepgram and tauri dependencies")


def test_tauri_conf_settings():
    """Verify tauri.conf.json has the expected app configuration."""
    conf_path = ROOT / "src" / "src-tauri" / "tauri.conf.json"
    conf = json.loads(conf_path.read_text())

    product_name = conf.get("productName", "")
    assert "deepgram" in product_name.lower() or "transcription" in product_name.lower(), \
        f"tauri.conf.json productName should reference Deepgram or Transcription, got: {product_name}"

    # App identifier should follow reverse-domain convention
    identifier = conf.get("identifier", "")
    assert "deepgram" in identifier.lower(), \
        f"tauri.conf.json identifier should include 'deepgram', got: {identifier}"

    # Must define at least one window
    windows = conf.get("app", {}).get("windows", [])
    assert len(windows) > 0, \
        "tauri.conf.json must define at least one window"

    assert windows[0].get("width", 0) > 0, "Window width must be positive"
    assert windows[0].get("height", 0) > 0, "Window height must be positive"

    print(f"tauri.conf.json settings valid:")
    print(f"  productName: {product_name}")
    print(f"  identifier: {identifier}")
    print(f"  window: {windows[0].get('width')}x{windows[0].get('height')}")


def test_typescript_frontend_uses_tauri_invoke():
    """Verify the TypeScript frontend calls the Rust backend via Tauri's invoke()."""
    main_ts = (ROOT / "src" / "src" / "main.ts").read_text()

    assert 'from "@tauri-apps/api/core"' in main_ts or \
           'from "@tauri-apps/api"' in main_ts, \
        "main.ts must import from @tauri-apps/api"
    assert "invoke" in main_ts, \
        "main.ts must call invoke() to communicate with the Rust backend"
    assert "start_transcription" in main_ts, \
        "main.ts must invoke start_transcription Tauri command"
    assert "send_audio" in main_ts, \
        "main.ts must invoke send_audio Tauri command"
    assert "stop_transcription" in main_ts, \
        "main.ts must invoke stop_transcription Tauri command"

    print("TypeScript frontend correctly uses Tauri invoke() for backend communication")


def test_typescript_frontend_audio_capture():
    """Verify the TypeScript frontend captures microphone audio for Deepgram."""
    main_ts = (ROOT / "src" / "src" / "main.ts").read_text()

    assert "getUserMedia" in main_ts, \
        "main.ts must use getUserMedia to capture microphone audio"
    # 16000 Hz matches the Deepgram linear16 encoding config in main.rs
    assert "16000" in main_ts, \
        "main.ts should configure audio at 16000 Hz to match Deepgram encoding"

    print("TypeScript frontend captures microphone audio at 16 kHz for Deepgram")


if __name__ == "__main__":
    test_file_structure()
    test_rust_source_uses_deepgram_sdk()
    test_cargo_toml_pins_deepgram()
    test_tauri_conf_settings()
    test_typescript_frontend_uses_tauri_invoke()
    test_typescript_frontend_audio_capture()
    print("\nAll tests passed")
