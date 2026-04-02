"""Django Channels WebSocket consumer that bridges browser audio to Deepgram Live STT.

Audio flows: browser microphone -> Django Channels WebSocket -> Deepgram Live STT -> transcript back to browser.
The DEEPGRAM_API_KEY stays server-side — the browser never sees it.
"""

import asyncio
import json
import os

from channels.generic.websocket import AsyncWebsocketConsumer
from deepgram import AsyncDeepgramClient
from deepgram.core.events import EventType
from deepgram.listen.v1.types import ListenV1Results


class TranscriptionConsumer(AsyncWebsocketConsumer):
    """Receives raw audio bytes from the browser, streams them to Deepgram, and
    sends transcription results back as JSON messages."""

    async def connect(self):
        await self.accept()
        self._dg_client = AsyncDeepgramClient(
            api_key=os.environ["DEEPGRAM_API_KEY"]
        )
        # ← connect() returns a live WebSocket connection to Deepgram's STT API
        self._dg_connection = await self._dg_client.listen.v1.connect(
            model="nova-3",
            smart_format=True,
            interim_results=True,
            encoding="linear16",
            sample_rate=16000,
            channels=1,
        )

        async def on_message(message) -> None:
            if isinstance(message, ListenV1Results):
                # message.channel.alternatives[0].transcript — the transcribed text
                transcript = message.channel.alternatives[0].transcript
                if transcript.strip():
                    await self.send(
                        text_data=json.dumps(
                            {
                                "transcript": transcript,
                                "is_final": message.is_final,
                            }
                        )
                    )

        async def on_error(error) -> None:
            await self.send(
                text_data=json.dumps({"error": str(error)})
            )

        self._dg_connection.on(EventType.MESSAGE, on_message)
        self._dg_connection.on(EventType.ERROR, on_error)

        # Runs the Deepgram receive loop in the background so events dispatch
        self._listener_task = asyncio.create_task(
            self._dg_connection.start_listening()
        )

    async def disconnect(self, close_code):
        if hasattr(self, "_dg_connection"):
            try:
                await self._dg_connection.send_close_stream()
            except Exception:
                pass
        if hasattr(self, "_listener_task"):
            self._listener_task.cancel()

    async def receive(self, text_data=None, bytes_data=None):
        # Browser sends raw PCM audio as binary WebSocket frames
        if bytes_data:
            await self._dg_connection.send_media(bytes_data)
