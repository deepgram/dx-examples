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

# We can't run the full Pipecat voice pipeline in CI (it needs a microphone
# or a Daily room), but we CAN verify:
#   1. Pipecat and its Deepgram plugin import correctly
#   2. The pipeline module itself is syntactically valid
#   3. The pipeline module correctly references Deepgram services

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))


def test_pipecat_imports():
    """Verify Pipecat and the Deepgram plugin are installed and importable."""
    from pipecat.pipeline.pipeline import Pipeline
    from pipecat.services.deepgram.stt import DeepgramSTTService
    from pipecat.services.deepgram.tts import DeepgramTTSService

    assert Pipeline is not None
    assert DeepgramSTTService is not None
    assert DeepgramTTSService is not None

    print("Pipecat + Deepgram plugin imports working")


def test_pipeline_module_imports():
    """Verify the pipeline source module imports without errors."""
    import pipeline  # noqa: F401

    print("Pipeline module imports correctly")


def test_pipeline_exports_deepgram_services():
    """Verify the pipeline source module references Deepgram STT and TTS services."""
    import pipeline

    # The module exposes run_local_pipeline and run_daily_pipeline as top-level
    # callables — they're the entry points for the two operating modes.
    assert callable(pipeline.run_local_pipeline), \
        "pipeline.py must define run_local_pipeline()"
    assert callable(pipeline.run_daily_pipeline), \
        "pipeline.py must define run_daily_pipeline()"

    print("Pipeline module exports run_local_pipeline and run_daily_pipeline")


def test_pipeline_source_configures_deepgram():
    """Verify the pipeline source code uses Deepgram STT and TTS with correct parameters."""
    src = (Path(__file__).parent.parent / "src" / "pipeline.py").read_text()

    assert "DeepgramSTTService" in src, \
        "pipeline.py must use DeepgramSTTService for speech-to-text"
    assert "DeepgramTTSService" in src, \
        "pipeline.py must use DeepgramTTSService for text-to-speech"
    assert "nova-3" in src or "DEEPGRAM_API_KEY" in src, \
        "pipeline.py should reference Deepgram STT configuration"
    assert "aura-2" in src, \
        "pipeline.py must configure an aura-2 TTS voice"
    assert 'tag="deepgram-examples"' in src, \
        "DeepgramSTTService must include tag='deepgram-examples'"

    print("Pipeline source correctly configures Deepgram STT and TTS")


def test_pipeline_module_main_entry():
    """Verify the pipeline module has a main() entry point."""
    import pipeline

    assert callable(pipeline.main), \
        "pipeline.py must define a main() function"

    print("Pipeline module has a main() entry point")


if __name__ == "__main__":
    test_pipecat_imports()
    test_pipeline_module_imports()
    test_pipeline_exports_deepgram_services()
    test_pipeline_source_configures_deepgram()
    test_pipeline_module_main_entry()
    print("\nAll tests passed")
