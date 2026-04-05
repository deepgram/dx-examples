"""Haystack 2.x component that transcribes audio via Deepgram Pre-recorded STT.

Usage:
    # Transcribe a single URL and search the transcript
    python src/transcriber.py https://dpgr.am/spacewalk.wav

    # Batch mode — transcribe multiple audio files
    python src/transcriber.py https://dpgr.am/spacewalk.wav https://dpgr.am/spacewalk.wav
"""

import os
import sys
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

load_dotenv()

from deepgram import DeepgramClient
from haystack import Document, Pipeline, component
from haystack.components.preprocessors import DocumentCleaner
from haystack.document_stores.in_memory import InMemoryDocumentStore
from haystack.components.writers import DocumentWriter


@component
class DeepgramTranscriber:
    """Haystack 2.x @component that accepts audio URLs, transcribes them with
    Deepgram nova-3, and outputs Haystack Document objects with rich metadata
    (speaker labels, word timestamps, confidence scores).

    Deepgram processes the audio server-side — the audio never passes through
    this component. This is faster and more memory-efficient than downloading
    the file first.
    """

    def __init__(
        self,
        model: str = "nova-3",
        smart_format: bool = True,
        diarize: bool = True,
        language: str = "en",
    ) -> None:
        self.model = model
        self.smart_format = smart_format
        self.diarize = diarize
        self.language = language

    @component.output_types(documents=List[Document])
    def run(self, urls: List[str]) -> Dict[str, List[Document]]:
        """Transcribe each URL and return Haystack Documents.

        Returns a dict with key "documents" — the Haystack component contract.
        Each Document contains the full transcript as text and Deepgram metadata
        (duration, confidence, word-level timestamps, speaker labels) as metadata.
        """
        api_key = os.environ.get("DEEPGRAM_API_KEY")
        if not api_key:
            raise RuntimeError(
                "DEEPGRAM_API_KEY not set. Get one at https://console.deepgram.com/"
            )

        client = DeepgramClient()
        documents = []

        for url in urls:
            doc = self._transcribe_url(client, url)
            documents.append(doc)

        return {"documents": documents}

    def _transcribe_url(self, client: DeepgramClient, url: str) -> Document:
        # diarize=True enables speaker labels — each word gets a speaker ID
        # so you can reconstruct who said what in multi-speaker audio.
        response = client.listen.v1.media.transcribe_url(
            url=url,
            model=self.model,
            smart_format=self.smart_format,
            diarize=self.diarize,
            language=self.language,
            tag="deepgram-examples",
        )

        # response.results.channels[0].alternatives[0].transcript
        channel = response.results.channels[0]
        alt = channel.alternatives[0]
        transcript = alt.transcript
        words = alt.words or []
        duration = words[-1].end if words else 0.0

        speakers = set()
        word_data = []
        for w in words:
            word_data.append({
                "word": w.word,
                "start": w.start,
                "end": w.end,
                "confidence": w.confidence,
                "speaker": getattr(w, "speaker", None),
            })
            if getattr(w, "speaker", None) is not None:
                speakers.add(w.speaker)

        metadata: Dict[str, Any] = {
            "source": url,
            "duration_seconds": round(duration, 2),
            "confidence": alt.confidence,
            "model": self.model,
            "language": self.language,
            "word_count": len(words),
            "speaker_count": len(speakers),
            "words": word_data,
        }

        return Document(content=transcript, meta=metadata)


def build_ingest_pipeline(
    document_store: Optional[InMemoryDocumentStore] = None,
) -> Pipeline:
    """Build a Haystack pipeline: transcribe → clean → write to document store.

    This is the pattern for audio ingestion in a RAG system: audio URLs go in,
    searchable Documents come out in the document store.
    """
    if document_store is None:
        document_store = InMemoryDocumentStore()

    pipeline = Pipeline()
    pipeline.add_component("transcriber", DeepgramTranscriber())
    pipeline.add_component("cleaner", DocumentCleaner())
    pipeline.add_component("writer", DocumentWriter(document_store=document_store))

    pipeline.connect("transcriber.documents", "cleaner.documents")
    pipeline.connect("cleaner.documents", "writer.documents")

    return pipeline


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python src/transcriber.py <audio-url> [<audio-url> ...]")
        sys.exit(1)

    audio_urls = sys.argv[1:]

    store = InMemoryDocumentStore()
    pipeline = build_ingest_pipeline(document_store=store)

    print(f"Transcribing {len(audio_urls)} audio file(s)...")
    result = pipeline.run({"transcriber": {"urls": audio_urls}})

    written = result.get("writer", {}).get("documents_written", 0)
    print(f"\n{written} document(s) written to the document store.")

    docs = store.filter_documents()
    for i, doc in enumerate(docs):
        print(f"\n{'='*60}")
        print(f"Document {i + 1}")
        print(f"{'='*60}")
        print(f"Source: {doc.meta.get('source', 'unknown')}")
        print(f"Duration: {doc.meta.get('duration_seconds', 0):.1f}s")
        print(f"Confidence: {doc.meta.get('confidence', 0):.0%}")
        print(f"Speakers: {doc.meta.get('speaker_count', 0)}")
        print(f"Words: {doc.meta.get('word_count', 0)}")
        print(f"\nTranscript preview:\n  {doc.content[:300]}...")


if __name__ == "__main__":
    main()
