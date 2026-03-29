import logging
import os

from dotenv import load_dotenv

load_dotenv()

# LiveKit agents v1.4+ uses a declarative pipeline: you pick an STT, LLM, and
# TTS provider and the framework handles audio routing, turn detection, and
# interruption logic.  Deepgram is plugged in via livekit-plugins-deepgram
# which wraps the Deepgram SDK internally — you don't call the Deepgram SDK
# directly.
from livekit.agents import (
    Agent,
    AgentServer,
    AgentSession,
    JobContext,
    JobProcess,
    cli,
    inference,
    room_io,
)
from livekit.plugins import silero
from livekit.plugins.turn_detector.multilingual import MultilingualModel

logger = logging.getLogger("deepgram-livekit-agent")


class VoiceAssistant(Agent):
    """A minimal voice assistant that uses Deepgram for STT.

    Subclassing Agent lets you define the system prompt and override lifecycle
    hooks like on_enter (called when the agent joins the room).
    """

    def __init__(self) -> None:
        super().__init__(
            # Keep the prompt short and voice-oriented — the agent speaks, so
            # markdown, emojis, and long paragraphs sound unnatural when read
            # aloud by TTS.
            instructions=(
                "You are a friendly voice assistant powered by Deepgram "
                "speech-to-text and LiveKit. Keep answers concise and "
                "conversational — one or two sentences at most. Do not use "
                "emojis, markdown, or special formatting in your responses."
            ),
        )

    async def on_enter(self) -> None:
        # Greet the user as soon as the agent joins the room, rather than
        # waiting for the user to speak first.
        self.session.generate_reply(
            instructions="Greet the user warmly and ask how you can help."
        )


server = AgentServer()


def prewarm(proc: JobProcess) -> None:
    # Silero VAD (Voice Activity Detection) is loaded once per worker process
    # and reused across sessions.  Loading takes ~200 ms — doing it in prewarm
    # avoids that latency on the first call.
    proc.userdata["vad"] = silero.VAD.load()


server.setup_fnc = prewarm


@server.rtc_session()
async def entrypoint(ctx: JobContext) -> None:
    ctx.log_context_fields = {"room": ctx.room.name}

    # inference.STT("deepgram/nova-3") tells the LiveKit agents framework to
    # use the Deepgram plugin with the nova-3 model.  The plugin reads
    # DEEPGRAM_API_KEY from the environment automatically.
    #
    # language="multi" enables automatic language detection — the agent can
    # understand any language Deepgram supports without explicit configuration.
    # For a single-language deployment, pin it (e.g. language="en") to reduce
    # latency by ~50 ms.
    session = AgentSession(
        stt=inference.STT("deepgram/nova-3", language="multi"),
        llm=inference.LLM("openai/gpt-4.1-mini"),
        # Cartesia sonic-3 is the default TTS in LiveKit examples.  You could
        # also use Deepgram TTS here: inference.TTS("deepgram/aura-2-thalia-en")
        tts=inference.TTS(
            "cartesia/sonic-3",
            voice="9626c31c-bec5-4cca-baa8-f8ba9e84c8bc",
        ),
        vad=ctx.proc.userdata["vad"],
        # MultilingualModel is a lightweight transformer that detects when the
        # user has finished speaking — more accurate than silence-based detection
        # for conversational voice interactions.
        turn_detection=MultilingualModel(),
        # preemptive_generation starts LLM inference as soon as the user begins
        # to trail off, cutting perceived latency by 200-400 ms.
        preemptive_generation=True,
    )

    await session.start(
        agent=VoiceAssistant(),
        room=ctx.room,
    )

    await ctx.connect()


if __name__ == "__main__":
    cli.run_app(server)
