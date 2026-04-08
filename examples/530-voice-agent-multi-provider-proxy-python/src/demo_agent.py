"""Demo: connect a Deepgram Voice Agent to the multi-provider proxy.

This script opens a WebSocket to the Deepgram Voice Agent API with
think.endpoint.url pointed at the local proxy server, then streams
microphone audio and plays back the agent's TTS responses.

Prerequisites:
    1. Start the proxy:  uvicorn src.proxy:app --port 8080
    2. Run this script:  python src/demo_agent.py

The Voice Agent handles STT (nova-3) and TTS (aura-2) directly via
Deepgram, while all LLM "thinking" goes through the proxy — which
routes to whichever provider LLM_PROVIDER is set to.
"""

from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

load_dotenv()

from deepgram import DeepgramClient
from deepgram.agent.v1.types.agent_v1settings import AgentV1Settings

PROXY_URL = os.environ.get("PROXY_URL", "http://localhost:8080/v1/chat/completions")


def build_settings(proxy_url: str = PROXY_URL) -> AgentV1Settings:
    """Build the Voice Agent Settings message with the proxy as the LLM backend."""
    return AgentV1Settings(
        type="Settings",
        tags=["deepgram-examples"],
        audio={
            "input": {
                "encoding": "linear16",
                "sample_rate": 16000,
            },
            "output": {
                "encoding": "linear16",
                "sample_rate": 16000,
            },
        },
        agent={
            "listen": {
                "provider": {
                    "type": "deepgram",
                    "model": "nova-3",
                },
            },
            "think": {
                "provider": {
                    "type": "open_ai",
                    "model": "gpt-4o-mini",
                },
                "endpoint": {
                    "url": proxy_url,
                    "headers": {},
                },
                "prompt": (
                    "You are a helpful voice assistant. Keep responses concise "
                    "and conversational — the user is speaking, not reading."
                ),
            },
            "speak": {
                "provider": {
                    "type": "deepgram",
                    "model": "aura-2-thalia-en",
                },
            },
            "greeting": "Hello! I'm your voice assistant. How can I help?",
        },
    )


def run_agent(proxy_url: str = PROXY_URL) -> None:
    """Connect to the Voice Agent and print events until interrupted."""
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        print("Error: DEEPGRAM_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    settings = build_settings(proxy_url)

    print(f"Connecting to Deepgram Voice Agent…")
    print(f"  LLM proxy: {proxy_url}")

    client = DeepgramClient(api_key=api_key)

    with client.agent.v1.connect() as ws:
        ws.send_settings(settings)
        print("Settings sent, waiting for agent…")

        try:
            while True:
                msg = ws.recv()

                if isinstance(msg, bytes):
                    print(f"  [audio] {len(msg)} bytes")
                    continue

                msg_type = getattr(msg, "type", "")

                if msg_type == "Welcome":
                    print(f"  Connected — request_id: {msg.request_id}")
                elif msg_type == "SettingsApplied":
                    print("  Settings applied — agent ready")
                    print("  (Send audio to interact, or Ctrl+C to stop)")
                elif msg_type == "ConversationText":
                    print(f"  [{msg.role}] {msg.content}")
                elif msg_type == "AgentStartedSpeaking":
                    print(f"  Agent speaking (latency: {msg.total_latency:.2f}s)")
                elif msg_type == "AgentAudioDone":
                    print("  Agent audio done")
                elif msg_type == "Error":
                    print(f"  ERROR: {msg.description} ({msg.code})")
                elif msg_type == "Warning":
                    print(f"  WARNING: {msg.description}")
                else:
                    print(f"  [{msg_type}] {str(msg)[:120]}")

        except KeyboardInterrupt:
            print("\nDisconnecting…")


if __name__ == "__main__":
    run_agent()
