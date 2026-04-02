"""CrewAI multi-agent voice crew with Deepgram STT & TTS.

A three-agent crew that demonstrates voice-in/voice-out multi-agent
coordination: Deepgram transcribes spoken audio, CrewAI agents process
and research the request, and Deepgram synthesises a spoken response.

Pipeline:
  audio file -> Deepgram STT (nova-3) -> CrewAI crew -> Deepgram TTS (aura-2) -> audio file

Usage:
    python src/crew.py                          # uses default sample audio
    python src/crew.py path/to/audio.wav        # transcribe your own file
"""

import os
import sys
import tempfile
from pathlib import Path

from dotenv import load_dotenv

load_dotenv()

if not os.environ.get("DEEPGRAM_API_KEY"):
    print("Error: DEEPGRAM_API_KEY is not set.", file=sys.stderr)
    print("Get a free key at https://console.deepgram.com/", file=sys.stderr)
    sys.exit(1)

if not os.environ.get("OPENAI_API_KEY"):
    print("Error: OPENAI_API_KEY is not set.", file=sys.stderr)
    print("Get a key at https://platform.openai.com/api-keys", file=sys.stderr)
    sys.exit(1)

from crewai import Agent, Crew, Process, Task
from crewai.tools import tool
from deepgram import DeepgramClient

AUDIO_URL = "https://dpgr.am/spacewalk.wav"


def get_deepgram_client() -> DeepgramClient:
    return DeepgramClient()


# ── Deepgram STT tool ────────────────────────────────────────────────────────

@tool
def transcribe_audio(audio_source: str) -> str:
    """Transcribe an audio file or URL using Deepgram speech-to-text.

    Accepts a local file path or a public URL. Returns the full transcript.
    """
    client = get_deepgram_client()

    if audio_source.startswith(("http://", "https://")):
        # Deepgram fetches the URL server-side — no local download needed
        response = client.listen.v1.media.transcribe_url(
            url=audio_source,
            model="nova-3",
            smart_format=True,
            tag="deepgram-examples",
        )
    else:
        audio_bytes = Path(audio_source).read_bytes()
        response = client.listen.v1.media.transcribe_file(
            audio_bytes,
            model="nova-3",
            smart_format=True,
            tag="deepgram-examples",
        )

    # response.results.channels[0].alternatives[0].transcript
    transcript = response.results.channels[0].alternatives[0].transcript
    confidence = response.results.channels[0].alternatives[0].confidence

    return (
        f"Transcript (confidence {confidence:.0%}):\n\n{transcript}"
    )


# ── Deepgram TTS tool ────────────────────────────────────────────────────────

@tool
def speak_text(text: str) -> str:
    """Convert text to speech using Deepgram TTS and save as a WAV file.

    Returns the path to the generated audio file.
    """
    client = get_deepgram_client()

    # aura-2-asteria-en is a natural conversational voice.
    # Other options: aura-2-zeus-en, aura-2-orpheus-en, aura-2-luna-en
    # Full list: https://developers.deepgram.com/docs/tts-models
    output_path = os.path.join(tempfile.gettempdir(), "crewai_voice_output.wav")
    audio_iter = client.speak.v1.audio.generate(
        text=text,
        model="aura-2-asteria-en",
        encoding="linear16",
        sample_rate=24000,
        container="wav",
        tag="deepgram-examples",
    )

    with open(output_path, "wb") as f:
        for chunk in audio_iter:
            f.write(chunk)

    return f"Audio response saved to: {output_path}"


# ── CrewAI agents ────────────────────────────────────────────────────────────

def create_listener_agent() -> Agent:
    """Agent that handles voice input via Deepgram STT."""
    return Agent(
        role="Voice Listener",
        goal="Accurately transcribe spoken audio into text using Deepgram",
        backstory=(
            "You are a specialist in audio transcription. Your job is to "
            "take audio input and produce clean, accurate text using the "
            "Deepgram speech-to-text tool. Always use the transcribe_audio "
            "tool to process audio — never guess the content."
        ),
        tools=[transcribe_audio],
        verbose=True,
    )


def create_researcher_agent() -> Agent:
    """Agent that analyses the transcript and produces a response."""
    return Agent(
        role="Research Analyst",
        goal="Analyse transcribed speech and produce a clear, concise summary with key insights",
        backstory=(
            "You are an expert analyst who takes transcribed text and "
            "extracts the key points, themes, and actionable insights. "
            "Your summaries are concise, structured, and suitable to be "
            "read aloud. Keep your response under 100 words so it works "
            "well as spoken audio."
        ),
        verbose=True,
    )


def create_speaker_agent() -> Agent:
    """Agent that delivers the final response as spoken audio via Deepgram TTS."""
    return Agent(
        role="Voice Speaker",
        goal="Convert the research analysis into natural spoken audio using Deepgram TTS",
        backstory=(
            "You are a presentation specialist. Take the analysis from "
            "the researcher and convert it into natural, spoken audio. "
            "Before calling the speak_text tool, clean the text so it "
            "sounds natural when spoken — remove markdown, bullet points, "
            "and special formatting. Use the speak_text tool with the "
            "cleaned text."
        ),
        tools=[speak_text],
        verbose=True,
    )


# ── CrewAI tasks and crew ────────────────────────────────────────────────────

def build_crew(audio_source: str) -> Crew:
    """Assemble a sequential crew: listen -> research -> speak."""
    listener = create_listener_agent()
    researcher = create_researcher_agent()
    speaker = create_speaker_agent()

    listen_task = Task(
        description=(
            f"Transcribe the audio from: {audio_source}\n"
            "Use the transcribe_audio tool with this source. "
            "Return the full transcript text."
        ),
        expected_output="The complete transcript of the audio.",
        agent=listener,
    )

    research_task = Task(
        description=(
            "Analyse the transcript from the previous task. "
            "Identify the main topic, key points, and any notable details. "
            "Write a concise summary (under 100 words) that would sound "
            "natural when read aloud."
        ),
        expected_output="A concise spoken-friendly summary of the transcript content.",
        agent=researcher,
    )

    speak_task = Task(
        description=(
            "Take the research summary and convert it to spoken audio. "
            "First, clean up the text to remove any markdown formatting, "
            "bullet points, or special characters. Then use the speak_text "
            "tool to generate the audio file. Return the file path."
        ),
        expected_output="The file path to the generated audio response.",
        agent=speaker,
    )

    return Crew(
        agents=[listener, researcher, speaker],
        tasks=[listen_task, research_task, speak_task],
        # Sequential: each task's output flows to the next agent
        process=Process.sequential,
        verbose=True,
    )


def main():
    audio_source = sys.argv[1] if len(sys.argv) > 1 else AUDIO_URL

    print(f"Audio source: {audio_source}")
    print("Building CrewAI voice crew...")
    print("  Agent 1: Voice Listener (Deepgram STT)")
    print("  Agent 2: Research Analyst (LLM)")
    print("  Agent 3: Voice Speaker (Deepgram TTS)")
    print()

    crew = build_crew(audio_source)
    result = crew.kickoff()

    print("\n── Crew result ──")
    print(result)


if __name__ == "__main__":
    main()
