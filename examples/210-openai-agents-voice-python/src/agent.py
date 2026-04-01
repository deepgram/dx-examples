"""OpenAI Agents SDK voice pipeline with Deepgram STT & TTS.

Builds a conversational voice agent using the OpenAI Agents SDK's VoicePipeline.
Deepgram handles the speech layer (STT via nova-3, TTS via aura-2) while an
OpenAI agent provides conversational reasoning with tool-calling support.

The pipeline flow:
  microphone audio -> Deepgram STT -> OpenAI Agent -> Deepgram TTS -> speaker

Usage:
    python src/agent.py
"""

import asyncio
import os
import sys
from typing import Union

import numpy as np
from dotenv import load_dotenv

load_dotenv()

from deepgram import AsyncDeepgramClient
from deepgram.core.events import EventType
from deepgram.listen.v1.types import ListenV1Metadata, ListenV1Results
from deepgram.speak.v1.types import (
    SpeakV1Cleared,
    SpeakV1Flushed,
    SpeakV1Metadata,
    SpeakV1Text,
    SpeakV1Warning,
)

from agents import Agent
from agents.voice import (
    AudioInput,
    SingleAgentVoiceWorkflow,
    STTModel,
    STTModelSettings,
    StreamedAudioInput,
    StreamedTranscriptionSession,
    TTSModel,
    TTSModelSettings,
    VoiceModelProvider,
    VoicePipeline,
    VoicePipelineConfig,
    VoiceStreamEventAudio,
    VoiceStreamEventLifecycle,
)

ListenV1Response = Union[ListenV1Results, ListenV1Metadata]
SpeakV1Response = Union[bytes, SpeakV1Metadata, SpeakV1Flushed, SpeakV1Cleared, SpeakV1Warning]

AUDIO_URL = "https://dpgr.am/spacewalk.wav"


class DeepgramSTTModel(STTModel):
    """Deepgram-backed STT using the live WebSocket API (nova-3).

    The OpenAI Agents SDK calls `transcribe` for single-turn audio and
    `create_session` for streaming. Both route through Deepgram's v1
    listen API via the official SDK — no raw WebSocket code needed.
    """

    def __init__(self):
        self._client = AsyncDeepgramClient()

    @property
    def model_name(self) -> str:
        return "deepgram-nova-3"

    async def transcribe(
        self,
        input: AudioInput,
        settings: STTModelSettings,
        trace_include_sensitive_data: bool,
        trace_include_sensitive_audio_data: bool,
    ) -> str:
        # AudioInput.buffer is a numpy array (int16/float32).
        # Deepgram's pre-recorded API accepts raw bytes via transcribe_file.
        audio_bytes = input.buffer.tobytes()

        response = await self._client.listen.v1.media.transcribe_file(
            request=audio_bytes,
            model="nova-3",
            smart_format=True,
            encoding="linear16",
        )
        # response.results.channels[0].alternatives[0].transcript
        return response.results.channels[0].alternatives[0].transcript

    async def create_session(
        self,
        input: StreamedAudioInput,
        settings: STTModelSettings,
        trace_include_sensitive_data: bool,
        trace_include_sensitive_audio_data: bool,
    ) -> "DeepgramStreamedTranscription":
        return DeepgramStreamedTranscription(input, settings, self._client)


class DeepgramStreamedTranscription(StreamedTranscriptionSession):
    """Streams audio to Deepgram's live WebSocket and yields final transcripts.

    Each call to `transcribe_turns` yields one complete utterance at a time,
    driven by Deepgram's endpointing (is_final=True). The OpenAI Agents SDK
    then feeds each utterance into the agent for processing.
    """

    def __init__(
        self,
        input: StreamedAudioInput,
        settings: STTModelSettings,
        client: AsyncDeepgramClient,
    ):
        self._input = input
        self._settings = settings
        self._client = client
        self._closed = False

    async def transcribe_turns(self):
        transcript_queue: asyncio.Queue[str | None] = asyncio.Queue()

        # Deepgram live connection — interim_results gives fast partial results,
        # but we only yield on is_final to get complete, punctuated utterances.
        async with self._client.listen.v1.connect(
            model="nova-3",
            smart_format=True,
            interim_results=True,
            encoding="linear16",
            sample_rate=24000,
            channels=1,
        ) as connection:

            async def on_message(message: ListenV1Response) -> None:
                if isinstance(message, ListenV1Results):
                    if message.is_final:
                        transcript = message.channel.alternatives[0].transcript
                        if transcript.strip():
                            transcript_queue.put_nowait(transcript)

            async def on_close(_) -> None:
                transcript_queue.put_nowait(None)

            connection.on(EventType.MESSAGE, on_message)
            connection.on(EventType.CLOSE, on_close)

            async def feed_audio():
                while not self._closed:
                    try:
                        audio_chunk = await asyncio.wait_for(
                            self._input.queue.get(), timeout=0.1
                        )
                    except asyncio.TimeoutError:
                        continue
                    if audio_chunk is None:
                        break
                    if isinstance(audio_chunk, np.ndarray):
                        audio_chunk = audio_chunk.tobytes()
                    await connection.send_media(audio_chunk)
                await connection.send_close_stream()

            # start_listening runs the receive loop in the background,
            # dispatching events to on_message/on_close handlers
            listener = asyncio.create_task(connection.start_listening())
            feeder = asyncio.create_task(feed_audio())

            try:
                while True:
                    transcript = await transcript_queue.get()
                    if transcript is None:
                        break
                    yield transcript
            finally:
                self._closed = True
                feeder.cancel()
                listener.cancel()

    async def close(self) -> None:
        self._closed = True


class DeepgramTTSModel(TTSModel):
    """Deepgram-backed TTS using the WebSocket streaming API (aura-2).

    Streams synthesised PCM audio back as chunks, so the user hears the
    response before it's fully generated — crucial for conversational latency.
    """

    def __init__(self):
        self._client = AsyncDeepgramClient()

    @property
    def model_name(self) -> str:
        return "deepgram-aura-2"

    async def run(self, text: str, settings: TTSModelSettings):
        audio_queue: asyncio.Queue[bytes | None] = asyncio.Queue()

        # aura-2-asteria-en is a natural conversational voice.
        # Other options: aura-2-zeus-en, aura-2-orpheus-en, aura-2-luna-en
        # Full list: https://developers.deepgram.com/docs/tts-models
        async with self._client.speak.v1.connect(
            model="aura-2-asteria-en",
            encoding="linear16",
            sample_rate=24000,
        ) as connection:

            async def on_message(message: SpeakV1Response) -> None:
                if isinstance(message, bytes):
                    audio_queue.put_nowait(message)

            async def on_close(_) -> None:
                audio_queue.put_nowait(None)

            connection.on(EventType.MESSAGE, on_message)
            connection.on(EventType.CLOSE, on_close)

            # start_listening runs the receive loop, dispatching audio chunks
            # and metadata events to the registered handlers
            listener = asyncio.create_task(connection.start_listening())

            await connection.send_text(SpeakV1Text(text=text))
            await connection.send_flush()
            await connection.send_close()

            while True:
                chunk = await audio_queue.get()
                if chunk is None:
                    break
                yield chunk

            listener.cancel()


class DeepgramVoiceProvider(VoiceModelProvider):
    """Wires Deepgram STT and TTS into the OpenAI Agents SDK voice pipeline.

    Pass this as `model_provider` to VoicePipelineConfig so the pipeline
    uses Deepgram for all speech processing instead of the default OpenAI models.
    """

    def get_stt_model(self, model_name: str | None = None) -> STTModel:
        return DeepgramSTTModel()

    def get_tts_model(self, model_name: str | None = None) -> TTSModel:
        return DeepgramTTSModel()


def create_agent() -> Agent:
    """Create the OpenAI agent that powers the conversational logic.

    The agent uses GPT-4.1-mini for fast, cost-effective responses.
    The system prompt is kept short and voice-friendly — no markdown or
    formatting that would sound unnatural when spoken aloud.
    """
    return Agent(
        name="Voice Assistant",
        instructions=(
            "You are a helpful voice assistant powered by Deepgram and the "
            "OpenAI Agents SDK. Keep answers concise — one or two sentences. "
            "Do not use emojis, markdown, or special formatting. "
            "If asked about yourself, explain you use Deepgram for speech "
            "recognition and synthesis, and OpenAI for reasoning."
        ),
        model="gpt-4.1-mini",
    )


async def run_single_turn():
    """Demo mode: transcribe a sample audio file, run the agent, speak the response.

    Useful for testing the full pipeline without a microphone — downloads a
    NASA spacewalk audio clip, transcribes it with Deepgram STT, sends the
    transcript through the agent, and synthesises the response with Deepgram TTS.
    """
    print("Running single-turn demo (no microphone needed)...")

    import urllib.request

    if not os.environ.get("DEEPGRAM_API_KEY"):
        print("Error: DEEPGRAM_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)
    if not os.environ.get("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)

    # Download sample audio — NASA spacewalk recording, 16-bit PCM WAV
    print("Downloading sample audio...")
    audio_data = urllib.request.urlopen(AUDIO_URL).read()

    # Skip the 44-byte WAV header to get raw PCM samples
    raw_pcm = audio_data[44:]
    audio_array = np.frombuffer(raw_pcm, dtype=np.int16)

    agent = create_agent()
    workflow = SingleAgentVoiceWorkflow(agent)

    pipeline = VoicePipeline(
        workflow=workflow,
        config=VoicePipelineConfig(
            # ← THIS enables Deepgram as the speech provider instead of OpenAI
            model_provider=DeepgramVoiceProvider(),
        ),
    )

    audio_input = AudioInput(
        buffer=audio_array,
        frame_rate=8000,  # spacewalk.wav is 8kHz
        channels=1,
    )

    print("Processing through pipeline: Deepgram STT -> Agent -> Deepgram TTS")
    result = await pipeline.run(audio_input)

    total_samples = 0
    async for event in result.stream():
        if isinstance(event, VoiceStreamEventAudio) and event.data is not None:
            total_samples += len(event.data)
        elif isinstance(event, VoiceStreamEventLifecycle):
            print(f"  Lifecycle event: {event.event}")

    print(f"Pipeline complete — received {total_samples} audio samples")
    return total_samples > 0


async def run_streaming():
    """Interactive streaming mode: continuous conversation via microphone.

    Requires a microphone and speakers. Audio flows continuously through
    the pipeline — speak naturally and the agent responds in real-time.
    Uses StreamedAudioInput so audio is processed as it arrives, not
    buffered until you stop speaking.
    """
    try:
        import sounddevice as sd  # noqa: F401
    except ImportError:
        print("Error: sounddevice not installed.", file=sys.stderr)
        print("Run: pip install sounddevice", file=sys.stderr)
        sys.exit(1)

    if not os.environ.get("DEEPGRAM_API_KEY"):
        print("Error: DEEPGRAM_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)
    if not os.environ.get("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)

    import sounddevice as sd

    agent = create_agent()
    workflow = SingleAgentVoiceWorkflow(agent)

    pipeline = VoicePipeline(
        workflow=workflow,
        config=VoicePipelineConfig(
            model_provider=DeepgramVoiceProvider(),
        ),
    )

    streamed_input = StreamedAudioInput()

    SAMPLE_RATE = 24000
    CHANNELS = 1
    BLOCKSIZE = 4096

    print("Starting voice pipeline — speak into your microphone (Ctrl+C to quit)")

    def audio_callback(indata, frames, time, status):
        if status:
            print(f"Audio warning: {status}", file=sys.stderr)
        audio_chunk = indata[:, 0].copy()
        int16_chunk = (audio_chunk * 32767).astype(np.int16)
        asyncio.get_event_loop().call_soon_threadsafe(
            lambda: asyncio.ensure_future(streamed_input.add_audio(int16_chunk))
        )

    result = await pipeline.run(streamed_input)

    with sd.InputStream(
        samplerate=SAMPLE_RATE,
        channels=CHANNELS,
        blocksize=BLOCKSIZE,
        callback=audio_callback,
    ):
        async for event in result.stream():
            if isinstance(event, VoiceStreamEventAudio) and event.data is not None:
                sd.play(event.data, samplerate=SAMPLE_RATE)


def main():
    if "--stream" in sys.argv:
        asyncio.run(run_streaming())
    else:
        asyncio.run(run_single_turn())


if __name__ == "__main__":
    main()
