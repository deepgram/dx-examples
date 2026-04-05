import os
import sys
from pathlib import Path

# ── Credential check ────────────────────────────────────────────────────────
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

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))
from transcriber import DeepgramTranscriber, build_ingest_pipeline

from haystack import Document
from haystack.document_stores.in_memory import InMemoryDocumentStore

AUDIO_URL = "https://dpgr.am/spacewalk.wav"


def test_transcriber_component():
    """Verify DeepgramTranscriber returns Documents with transcript and metadata."""
    transcriber = DeepgramTranscriber()
    result = transcriber.run(urls=[AUDIO_URL])

    assert "documents" in result, "Component must return dict with 'documents' key"
    docs = result["documents"]
    assert len(docs) == 1, f"Expected 1 document, got {len(docs)}"

    doc = docs[0]
    assert isinstance(doc, Document), "Output must be a Haystack Document"
    assert len(doc.content) > 50, f"Transcript too short ({len(doc.content)} chars)"

    duration = doc.meta.get("duration_seconds", 0)
    assert duration > 0, "Duration metadata missing"
    chars_per_sec = len(doc.content) / duration if duration else 0
    assert chars_per_sec > 2, f"Transcript too short for duration ({chars_per_sec:.1f} chars/s)"

    assert doc.meta.get("source") == AUDIO_URL, "Source metadata missing"
    assert doc.meta.get("confidence", 0) > 0.5, "Confidence too low"
    assert doc.meta.get("model") == "nova-3", "Model metadata incorrect"
    assert doc.meta.get("word_count", 0) > 0, "Word count missing"
    assert doc.meta.get("speaker_count", 0) >= 0, "Speaker count missing"

    words = doc.meta.get("words", [])
    assert len(words) > 0, "Word-level data missing"
    first_word = words[0]
    assert "word" in first_word, "Word data missing 'word' field"
    assert "start" in first_word, "Word data missing 'start' field"
    assert "end" in first_word, "Word data missing 'end' field"
    assert "confidence" in first_word, "Word data missing 'confidence' field"

    print("✓ DeepgramTranscriber component working")
    print(f"  Transcript length: {len(doc.content)} chars")
    print(f"  Duration: {duration:.1f}s")
    print(f"  Words: {doc.meta.get('word_count')}")
    print(f"  Speakers: {doc.meta.get('speaker_count')}")


def test_batch_transcription():
    """Verify the component handles multiple URLs in a single run."""
    transcriber = DeepgramTranscriber()
    result = transcriber.run(urls=[AUDIO_URL, AUDIO_URL])

    docs = result["documents"]
    assert len(docs) == 2, f"Expected 2 documents, got {len(docs)}"

    for i, doc in enumerate(docs):
        assert len(doc.content) > 50, f"Document {i} transcript too short"
        assert doc.meta.get("source") == AUDIO_URL

    print("✓ Batch transcription working (2 documents)")


def test_ingest_pipeline():
    """Verify the full pipeline: transcribe → clean → write to document store."""
    store = InMemoryDocumentStore()
    pipeline = build_ingest_pipeline(document_store=store)

    result = pipeline.run({"transcriber": {"urls": [AUDIO_URL]}})

    written = result.get("writer", {}).get("documents_written", 0)
    assert written == 1, f"Expected 1 document written, got {written}"

    docs = store.filter_documents()
    assert len(docs) == 1, f"Expected 1 document in store, got {len(docs)}"

    doc = docs[0]
    assert len(doc.content) > 50, f"Stored document transcript too short"
    assert doc.meta.get("source") == AUDIO_URL
    assert doc.meta.get("duration_seconds", 0) > 0

    print("✓ Ingest pipeline working (transcribe → clean → write)")
    print(f"  Documents in store: {len(docs)}")
    print(f"  Transcript length: {len(doc.content)} chars")


if __name__ == "__main__":
    test_transcriber_component()
    test_batch_transcription()
    test_ingest_pipeline()
    print("\n✓ All tests passed")
