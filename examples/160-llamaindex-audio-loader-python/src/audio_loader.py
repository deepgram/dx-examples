"""LlamaIndex reader that transcribes audio via Deepgram and returns Documents.

Usage:
    # Load audio into LlamaIndex Documents and query them
    python src/audio_loader.py https://dpgr.am/spacewalk.wav

    # Query mode — ask a question about the audio content
    python src/audio_loader.py --query "What is the main topic?" https://dpgr.am/spacewalk.wav
"""

import os
import sys
from pathlib import Path
from typing import List, Optional

from dotenv import load_dotenv

load_dotenv()

# SDK v6 Python: DeepgramClient reads DEEPGRAM_API_KEY from env automatically.
from deepgram import DeepgramClient

# LlamaIndex core: Document is the atomic unit of data, BaseReader defines
# the load_data() contract that all readers/loaders implement.
from llama_index.core import VectorStoreIndex
from llama_index.core.readers.base import BaseReader
from llama_index.core.schema import Document


class DeepgramAudioReader(BaseReader):
    """Transcribes audio files using Deepgram and returns LlamaIndex Documents.

    Each audio URL becomes one Document whose text is the transcript.
    Deepgram Audio Intelligence results (summary, topics, sentiment) are
    attached as document metadata for filtering and enrichment in RAG pipelines.
    """

    def __init__(
        self,
        model: str = "nova-3",
        smart_format: bool = True,
        summarize: Optional[str] = "v2",
        topics: bool = True,
        sentiment: bool = True,
        detect_entities: bool = True,
        language: str = "en",
    ) -> None:
        self.model = model
        self.smart_format = smart_format
        self.summarize = summarize
        self.topics = topics
        self.sentiment = sentiment
        self.detect_entities = detect_entities
        self.language = language
        self._client = DeepgramClient()

    def load_data(self, audio_urls: List[str]) -> List[Document]:
        """Transcribe each audio URL and return a list of Documents.

        This follows the same pattern as llama-index-readers-assemblyai:
        audio in → transcription API → Document objects out.
        """
        documents = []
        for url in audio_urls:
            doc = self._transcribe_url(url)
            documents.append(doc)
        return documents

    def _transcribe_url(self, url: str) -> Document:
        """Transcribe a single audio URL and build a Document with metadata."""
        # ← transcribe_url has Deepgram fetch the audio server-side
        response = self._client.listen.v1.media.transcribe_url(
            url=url,
            model=self.model,
            smart_format=self.smart_format,
            # Audio Intelligence features run on the same transcription call —
            # they are parameters, not separate endpoints.
            summarize=self.summarize,
            topics=self.topics,
            sentiment=self.sentiment,
            detect_entities=self.detect_entities,
            language=self.language,
            tag="deepgram-examples",
        )

        # response.results.channels[0].alternatives[0].transcript
        channel = response.results.channels[0]
        alt = channel.alternatives[0]
        transcript = alt.transcript
        confidence = alt.confidence
        words = alt.words
        duration = words[-1].end if words else 0.0

        metadata = {
            "source": url,
            "duration_seconds": duration,
            "confidence": confidence,
            "model": self.model,
            "language": self.language,
        }

        # Audio Intelligence results live at response.results.{feature}
        summary = getattr(response.results, "summary", None)
        if summary and hasattr(summary, "short"):
            metadata["summary"] = summary.short

        topics_result = getattr(response.results, "topics", None)
        if topics_result and hasattr(topics_result, "segments"):
            topic_list = []
            for segment in topics_result.segments:
                for topic in getattr(segment, "topics", []):
                    if hasattr(topic, "topic"):
                        topic_list.append(topic.topic)
            metadata["topics"] = list(dict.fromkeys(topic_list))

        sentiments_result = getattr(response.results, "sentiments", None)
        if sentiments_result and hasattr(sentiments_result, "average"):
            metadata["average_sentiment"] = sentiments_result.average.sentiment

        entities_result = getattr(response.results, "entities", None)
        if entities_result and hasattr(entities_result, "segments"):
            entity_list = []
            for segment in entities_result.segments:
                if hasattr(segment, "value"):
                    entity_list.append(f"{segment.entity_type}: {segment.value}")
            metadata["entities"] = list(dict.fromkeys(entity_list))

        return Document(text=transcript, metadata=metadata)


def run_load(audio_urls: List[str]) -> None:
    """Load audio into Documents and print their content and metadata."""
    reader = DeepgramAudioReader()
    documents = reader.load_data(audio_urls)

    for i, doc in enumerate(documents):
        print(f"\n{'='*60}")
        print(f"Document {i+1}")
        print(f"{'='*60}")
        print(f"Source: {doc.metadata.get('source', 'unknown')}")
        print(f"Duration: {doc.metadata.get('duration_seconds', 0):.1f}s")
        print(f"Confidence: {doc.metadata.get('confidence', 0):.0%}")
        if "summary" in doc.metadata:
            print(f"Summary: {doc.metadata['summary']}")
        if "topics" in doc.metadata:
            print(f"Topics: {', '.join(doc.metadata['topics'][:5])}")
        if "entities" in doc.metadata:
            print(f"Entities: {', '.join(doc.metadata['entities'][:5])}")
        print(f"\nTranscript preview:\n  {doc.text[:300]}...")


def run_query(audio_urls: List[str], question: str) -> None:
    """Load audio, build a VectorStoreIndex, and query it.

    This demonstrates the full RAG pipeline: audio → Deepgram → Documents →
    embeddings → vector index → LLM-powered query.
    Requires OPENAI_API_KEY for LlamaIndex default LLM and embeddings.
    """
    if not os.environ.get("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY is not set.", file=sys.stderr)
        print("The query engine needs an LLM. Get a key at https://platform.openai.com/api-keys", file=sys.stderr)
        sys.exit(1)

    reader = DeepgramAudioReader()
    documents = reader.load_data(audio_urls)

    print(f"Loaded {len(documents)} document(s), building index...")

    # VectorStoreIndex embeds the documents and stores them for similarity search.
    # Default uses OpenAI text-embedding-ada-002 for embeddings and gpt-3.5-turbo for queries.
    index = VectorStoreIndex.from_documents(documents)
    query_engine = index.as_query_engine()

    response = query_engine.query(question)

    print(f"\n{'='*60}")
    print(f"Question: {question}")
    print(f"{'='*60}")
    print(f"\n{response}")


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python src/audio_loader.py <audio-url> [<audio-url> ...]")
        print("  python src/audio_loader.py --query 'Your question' <audio-url> [<audio-url> ...]")
        sys.exit(1)

    if sys.argv[1] == "--query":
        if len(sys.argv) < 4:
            print("Error: provide a question and at least one audio URL", file=sys.stderr)
            sys.exit(1)
        question = sys.argv[2]
        audio_urls = sys.argv[3:]
        run_query(audio_urls, question)
    else:
        audio_urls = sys.argv[1:]
        run_load(audio_urls)


if __name__ == "__main__":
    main()
