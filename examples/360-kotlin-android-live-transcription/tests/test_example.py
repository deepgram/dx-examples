import os
import sys
from pathlib import Path

# ── Credential check ───────────────────────────────────────────────────────
env_example = Path(__file__).resolve().parent.parent / ".env.example"
required = [
    l.split("=")[0].strip()
    for l in env_example.read_text().splitlines()
    if l.strip() and not l.startswith("#") and "=" in l
]
missing = [k for k in required if not os.environ.get(k)]
if missing:
    print(f"MISSING_CREDENTIALS: {','.join(missing)}", file=sys.stderr)
    sys.exit(2)
# ──────────────────────────────────────────────────────────────────────────

from deepgram import DeepgramClient

client = DeepgramClient()

AUDIO_URL = "https://static.deepgram.com/examples/Bueller-Life-moves-pretty-fast.wav"

# Verify the API key works with a pre-recorded transcription call
# (live WebSocket requires a real mic; pre-recorded proves the key + SDK work)
response = client.listen.rest.v("1").transcribe_url(
    {"url": AUDIO_URL},
    {"model": "nova-3", "tag": "deepgram-examples"},
)

transcript = response.results.channels[0].alternatives[0].transcript
assert len(transcript) > 0, "Expected non-empty transcript"
assert "life" in transcript.lower() or "moves" in transcript.lower(), (
    f"Unexpected transcript content: {transcript[:100]}"
)

print(f"OK — transcript: {transcript[:80]}...")

# Verify project structure
project_root = Path(__file__).resolve().parent.parent
assert (project_root / "app" / "build.gradle.kts").exists(), "Missing app/build.gradle.kts"
assert (project_root / "app" / "src" / "main" / "AndroidManifest.xml").exists(), "Missing AndroidManifest.xml"

vm_file = (
    project_root
    / "app"
    / "src"
    / "main"
    / "java"
    / "com"
    / "deepgram"
    / "example"
    / "livetranscription"
    / "TranscriptionViewModel.kt"
)
assert vm_file.exists(), "Missing TranscriptionViewModel.kt"

vm_content = vm_file.read_text()
assert "deepgram-examples" in vm_content, "tag='deepgram-examples' not found in ViewModel"
assert "ListenV1Model.NOVA3" in vm_content, "model=nova-3 not found in ViewModel"

print("All checks passed.")
