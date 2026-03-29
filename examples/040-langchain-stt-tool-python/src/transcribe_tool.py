"""LangChain tool that transcribes audio URLs using Deepgram nova-3.

Usage:
    # Standalone — call the tool directly
    python src/transcribe_tool.py https://dpgr.am/spacewalk.wav

    # With an agent — let the LLM decide when to transcribe
    python src/transcribe_tool.py --agent "Transcribe https://dpgr.am/spacewalk.wav and summarise it"
"""

import os
import sys
from typing import Annotated

from dotenv import load_dotenv

load_dotenv()

# LangChain v1: import from langchain_core, not the legacy langchain.tools path.
# The @tool decorator converts a plain function into a LangChain Tool with
# auto-generated schema from the type hints and docstring.
from langchain_core.tools import tool

# SDK v5 Python: DeepgramClient reads DEEPGRAM_API_KEY from env automatically
# when constructed with no arguments. You only need to pass a key explicitly
# if you're managing multiple keys or reading from a non-standard source.
from deepgram import DeepgramClient


@tool
def transcribe_audio(
    audio_url: Annotated[str, "Public URL of an audio file (MP3, WAV, FLAC, etc.)"],
) -> str:
    """Transcribe an audio file from a URL using Deepgram speech-to-text.

    Accepts any public audio URL. Returns the full transcript text with
    punctuation and formatting. Useful when you need to extract spoken
    content from a recording, podcast, meeting, or any audio source.
    """
    if not os.environ.get("DEEPGRAM_API_KEY"):
        return "Error: DEEPGRAM_API_KEY is not set. Get one at https://console.deepgram.com/"

    client = DeepgramClient()

    # SDK v5 Python: keyword arguments in a single call — not a separate
    # PrerecordedOptions object (that was the v3/v4 pattern).
    # transcribe_url() has Deepgram fetch the URL server-side, so the file
    # never passes through your machine. Use transcribe_file() for local files.
    response = client.listen.v1.media.transcribe_url(
        url=audio_url,
        # nova-3 is the current flagship model (2025). Alternatives:
        #   nova-3-phonecall  — optimised for telephony audio
        #   nova-3-medical    — HIPAA-eligible medical terminology
        model="nova-3",
        # smart_format adds punctuation, capitalisation, paragraph breaks,
        # and formats numbers/dates/currency. Adds ~10 ms — always worth it.
        smart_format=True,
    )

    transcript = response.results.channels[0].alternatives[0].transcript
    confidence = response.results.channels[0].alternatives[0].confidence
    words = response.results.channels[0].alternatives[0].words
    duration = words[-1].end if words else 0

    return (
        f"Transcript ({duration:.1f}s, confidence {confidence:.0%}):\n\n"
        f"{transcript}"
    )


def run_standalone(audio_url: str) -> None:
    """Call the tool directly without an LLM — useful for scripting."""
    result = transcribe_audio.invoke(audio_url)
    print(result)


def run_agent(user_input: str) -> None:
    """Run a LangChain agent that can use the transcribe tool when needed.

    The agent decides whether to call the tool based on the user's request.
    For example: "Transcribe this audio and list the key topics discussed."
    The LLM will call transcribe_audio, get the transcript, then summarise.
    """
    if not os.environ.get("OPENAI_API_KEY"):
        print("Error: OPENAI_API_KEY is not set.", file=sys.stderr)
        print("The agent needs an LLM. Get a key at https://platform.openai.com/api-keys", file=sys.stderr)
        sys.exit(1)

    # langchain-openai wraps the OpenAI SDK with LangChain's interface.
    # ChatOpenAI supports tool calling natively — the agent framework binds
    # our @tool functions to the model's function-calling API automatically.
    from langchain_openai import ChatOpenAI
    from langchain.agents import create_tool_calling_agent, AgentExecutor
    from langchain_core.prompts import ChatPromptTemplate

    llm = ChatOpenAI(model="gpt-4.1-mini", temperature=0)
    tools = [transcribe_audio]

    # "placeholder" for agent_scratchpad is required — it's where the agent
    # framework injects intermediate tool calls and results during execution.
    prompt = ChatPromptTemplate.from_messages([
        (
            "system",
            "You are a helpful assistant that can transcribe audio files using "
            "Deepgram. When given an audio URL, use the transcribe_audio tool to "
            "get the transcript, then answer the user's question about it.",
        ),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ])

    agent = create_tool_calling_agent(llm, tools, prompt)
    # verbose=True prints each step so you can see the agent's reasoning
    # and the tool call/response — invaluable for debugging.
    executor = AgentExecutor(agent=agent, tools=tools, verbose=True)

    result = executor.invoke({"input": user_input})
    print("\n── Agent response ──")
    print(result["output"])


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python src/transcribe_tool.py <audio-url>")
        print("  python src/transcribe_tool.py --agent 'Transcribe <url> and summarise'")
        sys.exit(1)

    if sys.argv[1] == "--agent":
        if len(sys.argv) < 3:
            print("Error: provide a prompt after --agent", file=sys.stderr)
            sys.exit(1)
        run_agent(" ".join(sys.argv[2:]))
    else:
        run_standalone(sys.argv[1])


if __name__ == "__main__":
    main()
