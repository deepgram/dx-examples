"""FastAPI proxy server that keeps the Deepgram API key server-side.

Clients interact only with this proxy — the key never leaves the server.
This is the recommended pattern for browser-based apps that need
Deepgram STT or TTS without exposing secrets.

Endpoints:
    POST /v1/listen          — pre-recorded transcription (URL or file upload)
    POST /v1/speak           — text-to-speech (returns audio bytes)
    WS   /v1/listen/stream   — live STT streaming (bidirectional WebSocket)
    GET  /health             — health check

Usage:
    uvicorn src.server:app --reload
"""

import asyncio
import json
import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.responses import HTMLResponse, StreamingResponse
from pydantic import BaseModel

from deepgram import AsyncDeepgramClient
from deepgram.core.events import EventType
from deepgram.listen.v1.types import ListenV1Results

load_dotenv()

LIVE_OPTIONS = {
    "model": "nova-3",
    "encoding": "linear16",
    "sample_rate": 16000,
    "channels": 1,
    "tag": "deepgram-examples",
    "request_options": {
        "additional_query_parameters": {
            "smart_format": "true",
            "interim_results": "true",
            "utterance_end_ms": "1500",
        }
    },
}


def _get_api_key() -> str:
    key = os.environ.get("DEEPGRAM_API_KEY", "")
    if not key:
        raise HTTPException(
            status_code=500,
            detail="DEEPGRAM_API_KEY is not set. Copy .env.example to .env and add your key.",
        )
    return key


def create_app() -> FastAPI:
    application = FastAPI(
        title="Deepgram Proxy Server",
        description="Proxies Deepgram STT and TTS requests, keeping the API key server-side.",
        version="1.0.0",
    )

    class ListenUrlBody(BaseModel):
        url: str
        model: str = "nova-3"
        smart_format: bool = True
        diarize: bool = False

    class SpeakBody(BaseModel):
        text: str
        model: str = "aura-2-asteria-en"

    # -- REST: pre-recorded transcription ------------------------------------
    @application.post("/v1/listen")
    async def listen_url(body: ListenUrlBody):
        _get_api_key()
        client = AsyncDeepgramClient()
        try:
            response = await client.listen.v1.media.transcribe_url(
                url=body.url,
                model=body.model,
                smart_format=body.smart_format,
                diarize=body.diarize,
                tag="deepgram-examples",
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"Transcription failed: {exc}") from exc

        return response.model_dump()

    # -- REST: text-to-speech ------------------------------------------------
    @application.post("/v1/speak")
    async def speak(body: SpeakBody):
        _get_api_key()
        client = AsyncDeepgramClient()
        try:
            audio_iter = client.speak.v1.audio.generate(
                text=body.text,
                model=body.model,
                encoding="mp3",
                tag="deepgram-examples",
            )
        except Exception as exc:
            raise HTTPException(status_code=502, detail=f"TTS failed: {exc}") from exc

        return StreamingResponse(audio_iter, media_type="audio/mpeg")

    # -- WebSocket: live STT streaming ---------------------------------------
    @application.websocket("/v1/listen/stream")
    async def listen_stream(ws: WebSocket):
        await ws.accept()
        _get_api_key()
        client = AsyncDeepgramClient()

        async with client.listen.v1.connect(**LIVE_OPTIONS) as dg_connection:
            async def on_message(message) -> None:
                if isinstance(message, ListenV1Results):
                    transcript = message.channel.alternatives[0].transcript
                    payload = json.dumps({
                        "channel": {
                            "alternatives": [{
                                "transcript": transcript,
                                "confidence": message.channel.alternatives[0].confidence,
                                "words": [
                                    {"word": w.word, "start": w.start, "end": w.end, "confidence": w.confidence}
                                    for w in (message.channel.alternatives[0].words or [])
                                ],
                            }]
                        },
                        "is_final": message.is_final,
                    })
                    try:
                        await ws.send_text(payload)
                    except Exception:
                        pass

            async def on_error(error) -> None:
                try:
                    await ws.send_text(json.dumps({"error": str(error)}))
                except Exception:
                    pass

            dg_connection.on(EventType.MESSAGE, on_message)
            dg_connection.on(EventType.ERROR, on_error)

            listener_task = asyncio.create_task(dg_connection.start_listening())

            try:
                while True:
                    data = await ws.receive_bytes()
                    await dg_connection.send_media(data)
            except WebSocketDisconnect:
                pass
            except Exception:
                pass
            finally:
                try:
                    await dg_connection.send_close_stream()
                except Exception:
                    pass
                listener_task.cancel()

    # -- Health check --------------------------------------------------------
    @application.get("/health")
    async def health():
        return {"status": "ok", "service": "deepgram-proxy"}

    # -- Demo client ---------------------------------------------------------
    @application.get("/", response_class=HTMLResponse)
    async def index():
        html_path = os.path.join(os.path.dirname(__file__), "client.html")
        with open(html_path) as f:
            return HTMLResponse(f.read())

    return application


app = create_app()

if __name__ == "__main__":
    import uvicorn

    port = int(os.environ.get("PORT", "3000"))
    print(f"Deepgram proxy listening on http://localhost:{port}")
    print("  POST /v1/listen          - pre-recorded transcription")
    print("  POST /v1/speak           - text-to-speech")
    print("  WS   /v1/listen/stream   - live STT streaming")
    print("  GET  /health             - health check")
    print("  GET  /                   - demo client")
    uvicorn.run(app, host="0.0.0.0", port=port)
