"""FastAPI server that transcribes uploaded audio files using Deepgram nova-3.

Usage:
    uvicorn src.main:app --reload

    # Upload an audio file
    curl -X POST http://localhost:8000/transcribe \
      -F "file=@recording.mp3"

    # Transcribe from a URL
    curl -X POST http://localhost:8000/transcribe-url \
      -H "Content-Type: application/json" \
      -d '{"url": "https://dpgr.am/spacewalk.wav"}'
"""

import os

from dotenv import load_dotenv
from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel

load_dotenv()

# SDK v5 Python: DeepgramClient reads DEEPGRAM_API_KEY from env automatically
# when constructed with no arguments. You only need to pass a key explicitly
# if you're managing multiple keys or reading from a non-standard source.
from deepgram import DeepgramClient

app = FastAPI(
    title="Deepgram Audio Transcription API",
    description="Upload audio files or provide URLs to get transcripts powered by Deepgram nova-3",
    version="1.0.0",
)


def get_client() -> DeepgramClient:
    if not os.environ.get("DEEPGRAM_API_KEY"):
        raise HTTPException(
            status_code=500,
            detail="DEEPGRAM_API_KEY not configured. Get one at https://console.deepgram.com/",
        )
    return DeepgramClient()


class UrlRequest(BaseModel):
    url: str
    model: str = "nova-3"
    smart_format: bool = True
    language: str | None = None


class TranscriptResponse(BaseModel):
    transcript: str
    confidence: float
    duration_seconds: float
    words_count: int


@app.post("/transcribe", response_model=TranscriptResponse)
async def transcribe_file(file: UploadFile = File(...)):
    """Transcribe an uploaded audio file.

    Accepts any format Deepgram supports: MP3, WAV, FLAC, OGG, M4A, WebM, etc.
    Files are read into memory and sent to Deepgram in a single request —
    for files larger than ~100 MB, consider streaming or using a URL instead.
    """
    client = get_client()

    content = await file.read()
    if len(content) == 0:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    # SDK v5 Python: transcribe_file() accepts raw bytes.
    # The SDK auto-detects the audio format from the file header — no need to
    # pass a MIME type unless the file is headerless raw PCM.
    try:
        response = client.listen.v1.media.transcribe_file(
            content,
            # nova-3 is the current flagship model (2025). For phone call
            # audio use nova-3-phonecall; for medical use nova-3-medical.
            model="nova-3",
            # smart_format adds punctuation, capitalisation, paragraph breaks,
            # and formats numbers/dates/currency. Adds ~10 ms — always worth it.
            smart_format=True,
        )
    except Exception as exc:
        # Common causes: 400 (unsupported format), 402 (quota exceeded),
        # 413 (file too large). The SDK wraps these in typed exceptions but
        # the message is usually clear enough to surface directly.
        raise HTTPException(status_code=400, detail=f"Transcription failed: {exc}") from exc

    return _build_response(response)


@app.post("/transcribe-url", response_model=TranscriptResponse)
async def transcribe_url(body: UrlRequest):
    """Transcribe audio from a public URL.

    Deepgram fetches the URL server-side — the audio never passes through
    this server. Faster and more memory-efficient than uploading the file.
    The URL must be publicly accessible (no auth headers are forwarded).
    """
    client = get_client()

    kwargs = {
        "url": body.url,
        "model": body.model,
        "smart_format": body.smart_format,
    }
    if body.language:
        kwargs["language"] = body.language

    try:
        response = client.listen.v1.media.transcribe_url(**kwargs)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Transcription failed: {exc}") from exc

    return _build_response(response)


def _build_response(response) -> TranscriptResponse:
    """Extract transcript data from the Deepgram response.

    channels[0] is always present — stereo audio produces two channels, but
    mono (the common case) has exactly one. alternatives[0] is the top result;
    request alternatives > 1 to get N-best lists.
    """
    alt = response.results.channels[0].alternatives[0]
    words = alt.words or []
    # words[-1].end gives the audio duration in seconds without needing
    # to parse the media file — a useful Deepgram feature.
    duration = words[-1].end if words else 0.0

    return TranscriptResponse(
        transcript=alt.transcript,
        confidence=alt.confidence,
        duration_seconds=round(duration, 2),
        words_count=len(words),
    )


@app.get("/health")
async def health():
    """Health check endpoint for load balancers and uptime monitors."""
    return {"status": "ok"}
