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

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from audio_loader import DeepgramAudioReader

AUDIO_URL = "https://dpgr.am/spacewalk.wav"


def test_deepgram_stt():
    """Verify the Deepgram API key works and nova-3 returns a transcript."""
    client = DeepgramClient()
    response = client.listen.v1.media.transcribe_url(
        url=AUDIO_URL,
        model="nova-3",
        smart_format=True,
        tag="deepgram-examples",
    )
    transcript = response.results.channels[0].alternatives[0].transcript
    assert len(transcript) > 10, "Transcript too short"

    assert len(transcript) > 50, f"Transcript unexpectedly short ({len(transcript)} chars): {transcript[:200]}"

    print("✓ Deepgram STT integration working")
    print(f"  Transcript preview: '{transcript[:80]}...'")


def test_audio_reader_load_data():
    """Verify DeepgramAudioReader returns Documents with transcript and metadata."""
    reader = DeepgramAudioReader()
    documents = reader.load_data([AUDIO_URL])

    assert len(documents) == 1, f"Expected 1 document, got {len(documents)}"

    doc = documents[0]
    assert len(doc.text) > 10, "Document text too short"
    assert doc.metadata.get("source") == AUDIO_URL, "Source metadata missing"
    assert doc.metadata.get("confidence", 0) > 0.5, "Confidence too low"
    assert doc.metadata.get("duration_seconds", 0) > 0, "Duration missing"
    assert doc.metadata.get("model") == "nova-3", "Model metadata incorrect"

    duration = doc.metadata.get("duration_seconds", 0)
    assert duration > 0, "Duration missing"
    chars_per_sec = len(doc.text) / duration if duration else 0
    assert chars_per_sec > 5, f"Transcript too short for duration ({chars_per_sec:.1f} chars/s)"

    print("✓ DeepgramAudioReader load_data working")
    print(f"  Document text length: {len(doc.text)} chars")
    print(f"  Metadata keys: {list(doc.metadata.keys())}")


def test_audio_reader_intelligence_metadata():
    """Verify Audio Intelligence features populate document metadata."""
    reader = DeepgramAudioReader(
        summarize="v2",
        topics=True,
        sentiment=True,
        detect_entities=True,
    )
    documents = reader.load_data([AUDIO_URL])
    doc = documents[0]

    has_intelligence = any(
        k in doc.metadata for k in ["summary", "topics", "entities", "average_sentiment"]
    )
    assert has_intelligence, (
        f"No Audio Intelligence metadata found. Keys: {list(doc.metadata.keys())}"
    )

    print("✓ Audio Intelligence metadata populated")
    if "summary" in doc.metadata:
        print(f"  Summary: {doc.metadata['summary'][:100]}...")
    if "topics" in doc.metadata:
        print(f"  Topics: {doc.metadata['topics'][:3]}")


def test_document_is_indexable():
    """Verify the Document objects work with LlamaIndex VectorStoreIndex."""
    from llama_index.core.schema import Document as LIDocument

    reader = DeepgramAudioReader()
    documents = reader.load_data([AUDIO_URL])
    doc = documents[0]

    assert isinstance(doc, LIDocument), "Document is not a LlamaIndex Document"
    assert doc.get_content() == doc.text, "get_content() should return text"
    assert doc.metadata is not None, "Document should have metadata"

    print("✓ Documents are valid LlamaIndex Document objects")


if __name__ == "__main__":
    test_deepgram_stt()
    test_audio_reader_load_data()
    test_audio_reader_intelligence_metadata()
    test_document_is_indexable()
