"""Pipecat voice pipeline using Deepgram for both STT and TTS.

This builds a conversational voice bot: microphone audio flows through
Deepgram STT → OpenAI LLM → Deepgram TTS, all orchestrated by Pipecat's
pipeline framework. The pipeline handles turn detection, interruption,
and audio routing automatically.

Usage:
    # Local console mode (uses your microphone and speakers)
    python src/pipeline.py

    # As a Daily.co WebRTC bot (requires DAILY_API_KEY)
    python src/pipeline.py --daily
"""

import asyncio
import os
import sys

from dotenv import load_dotenv

load_dotenv()

# Pipecat organises services into a linear pipeline of "processors."
# Each processor transforms frames (audio, text, control signals) and
# passes them downstream. The framework handles backpressure and
# concurrency — you just wire the pieces together.
from pipecat.audio.vad.silero import SileroVADAnalyzer
from pipecat.pipeline.pipeline import Pipeline
from pipecat.pipeline.runner import PipelineRunner
from pipecat.pipeline.task import PipelineParams, PipelineTask
from pipecat.processors.aggregators.openai_llm_context import OpenAILLMContext
from pipecat.services.deepgram.stt import DeepgramSTTService
from pipecat.services.deepgram.tts import DeepgramTTSService
from pipecat.services.openai.llm import OpenAILLMService
# Local and Daily transports are imported lazily inside their respective
# functions because they pull in native dependencies (pyaudio, daily-python)
# that are not available in all environments (e.g. CI).


async def run_local_pipeline():
    """Run the pipeline in local console mode using your microphone/speakers.

    This is the simplest way to test — no WebRTC infrastructure needed.
    Audio comes from your default input device and plays through your
    default output device.
    """

    if not os.environ.get("DEEPGRAM_API_KEY"):
        print("Error: DEEPGRAM_API_KEY is not set.", file=sys.stderr)
        print("Get one at https://console.deepgram.com/", file=sys.stderr)
        sys.exit(1)
    if not os.environ.get("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)

    # Deepgram STT: nova-3 is the current flagship model.
    # The Pipecat Deepgram plugin uses the live WebSocket API under the hood,
    # not the pre-recorded API — so transcription is real-time, word by word.
    stt = DeepgramSTTService(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        # Settings are exposed as a nested dataclass. Override only what you
        # need — Pipecat's defaults (interim_results, punctuate, etc.) are
        # already tuned for conversational use.
    )

    # Deepgram TTS: aura-2 voices are optimised for low-latency streaming.
    # The WebSocket-based DeepgramTTSService streams audio chunks as they're
    # synthesised, so the user hears the response before it's fully generated.
    tts = DeepgramTTSService(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        # aura-2-andromeda-en is a natural female voice. Other options:
        #   aura-2-zeus-en       (male, conversational)
        #   aura-2-orpheus-en    (male, warm)
        #   aura-2-luna-en       (female, smooth)
        # Full list: https://developers.deepgram.com/docs/tts-models
        voice="aura-2-andromeda-en",
    )

    llm = OpenAILLMService(
        api_key=os.environ["OPENAI_API_KEY"],
        model="gpt-4.1-mini",
    )

    # The LLM context holds the conversation history and system prompt.
    # Keep the system prompt short and voice-oriented — markdown, code blocks,
    # and long paragraphs sound unnatural when read aloud by TTS.
    messages = [
        {
            "role": "system",
            "content": (
                "You are a friendly voice assistant powered by Deepgram and "
                "Pipecat. Keep answers concise — one or two sentences at most. "
                "Do not use emojis, markdown, or special formatting."
            ),
        },
    ]
    context = OpenAILLMContext(messages)
    context_aggregator = llm.create_context_aggregator(context)

    # Silero VAD (Voice Activity Detection) runs locally and detects when
    # the user starts and stops speaking. This drives turn-taking — without
    # it, the pipeline wouldn't know when to stop listening and start
    # generating a response. Loading takes ~200 ms on first call.
    try:
        from pipecat.transports.local.audio import LocalAudioTransport
    except ImportError:
        print("Error: Local audio transport not installed.", file=sys.stderr)
        print("Run: pip install 'pipecat-ai[local]'", file=sys.stderr)
        sys.exit(1)

    vad = SileroVADAnalyzer()

    transport = LocalAudioTransport(vad_analyzer=vad)

    # The pipeline is a linear chain of processors. Data flows left to right:
    #   mic audio → STT → LLM context → LLM → TTS → speaker audio
    #
    # context_aggregator.user() collects STT output into LLM messages.
    # context_aggregator.assistant() captures LLM output for conversation history.
    pipeline = Pipeline([
        transport.input(),
        stt,
        context_aggregator.user(),
        llm,
        tts,
        transport.output(),
        context_aggregator.assistant(),
    ])

    task = PipelineTask(
        pipeline,
        params=PipelineParams(
            # allow_interruptions lets the user cut in while the bot is speaking.
            # The bot stops talking immediately and processes the new input.
            allow_interruptions=True,
        ),
    )

    runner = PipelineRunner()

    print("✓ Pipeline ready — speak into your microphone (Ctrl+C to quit)")
    await runner.run(task)


async def run_daily_pipeline():
    """Run the pipeline as a Daily.co WebRTC bot.

    Creates a temporary Daily room and prints the join URL. Open it in a
    browser to talk to the bot via WebRTC — much better audio quality than
    local mode, and works across devices/networks.
    """
    try:
        from pipecat.transports.services.daily import DailyParams, DailyTransport
    except ImportError:
        print("Error: Daily transport not installed.", file=sys.stderr)
        print("Run: pip install 'pipecat-ai[daily]'", file=sys.stderr)
        sys.exit(1)

    if not os.environ.get("DAILY_API_KEY"):
        print("Error: DAILY_API_KEY is not set.", file=sys.stderr)
        print("Get one at https://dashboard.daily.co/developers", file=sys.stderr)
        sys.exit(1)
    if not os.environ.get("DEEPGRAM_API_KEY"):
        print("Error: DEEPGRAM_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)
    if not os.environ.get("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY is not set.", file=sys.stderr)
        sys.exit(1)

    import aiohttp

    async with aiohttp.ClientSession() as session:
        # Create a temporary Daily room via their REST API.
        # exp is set to 30 minutes from now — the room auto-deletes.
        headers = {"Authorization": f"Bearer {os.environ['DAILY_API_KEY']}"}
        async with session.post(
            "https://api.daily.co/v1/rooms",
            headers=headers,
            json={"properties": {"exp": int(asyncio.get_event_loop().time()) + 1800}},
        ) as resp:
            room = await resp.json()
            room_url = room["url"]

    stt = DeepgramSTTService(api_key=os.environ["DEEPGRAM_API_KEY"])

    tts = DeepgramTTSService(
        api_key=os.environ["DEEPGRAM_API_KEY"],
        voice="aura-2-andromeda-en",
    )

    llm = OpenAILLMService(
        api_key=os.environ["OPENAI_API_KEY"],
        model="gpt-4.1-mini",
    )

    messages = [
        {
            "role": "system",
            "content": (
                "You are a friendly voice assistant powered by Deepgram and "
                "Pipecat. Keep answers concise. Do not use emojis or markdown."
            ),
        },
    ]
    context = OpenAILLMContext(messages)
    context_aggregator = llm.create_context_aggregator(context)

    # Daily transport handles WebRTC negotiation, audio encoding/decoding,
    # and network traversal. The bot joins the room as a participant —
    # users connect via the room URL in their browser.
    transport = DailyTransport(
        room_url,
        None,  # token — None uses the room's default permissions
        "Deepgram Bot",
        DailyParams(
            audio_in_enabled=True,
            audio_out_enabled=True,
            vad_enabled=True,
            vad_analyzer=SileroVADAnalyzer(),
        ),
    )

    pipeline = Pipeline([
        transport.input(),
        stt,
        context_aggregator.user(),
        llm,
        tts,
        transport.output(),
        context_aggregator.assistant(),
    ])

    task = PipelineTask(
        pipeline,
        params=PipelineParams(allow_interruptions=True),
    )

    @transport.event_handler("on_first_participant_joined")
    async def on_first_participant_joined(transport, participant):
        await task.queue_frames([])

    runner = PipelineRunner()

    print(f"✓ Pipeline ready — join the room: {room_url}")
    await runner.run(task)


def main():
    if "--daily" in sys.argv:
        asyncio.run(run_daily_pipeline())
    else:
        asyncio.run(run_local_pipeline())


if __name__ == "__main__":
    main()
