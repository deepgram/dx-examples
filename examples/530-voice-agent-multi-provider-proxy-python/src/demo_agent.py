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

import json
import os
import sys

from dotenv import load_dotenv

load_dotenv()

import websockets
import websockets.sync.client

DG_AGENT_URL = "wss://agent.deepgram.com/v1/agent/converse"

PROXY_URL = os.environ.get("PROXY_URL", "http://localhost:8080/v1/chat/completions")


def build_settings(proxy_url: str = PROXY_URL) -> dict:
    """Build the Voice Agent Settings message with the proxy as the LLM backend."""
    return {
        "type": "Settings",
        "audio": {
            "input": {
                "encoding": "linear16",
                "sample_rate": 16000,
            },
            "output": {
                "encoding": "linear16",
                "sample_rate": 16000,
            },
        },
        "agent": {
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
    }


def run_agent(proxy_url: str = PROXY_URL) -> None:
    """Connect to the Voice Agent and print events until interrupted."""
    api_key = os.environ.get("DEEPGRAM_API_KEY")
    if not api_key:
        print("Error: DEEPGRAM_API_KEY not set", file=sys.stderr)
        sys.exit(1)

    settings = build_settings(proxy_url)

    print(f"Connecting to Deepgram Voice Agent…")
    print(f"  LLM proxy: {proxy_url}")

    ws = websockets.sync.client.connect(
        DG_AGENT_URL,
        additional_headers={"Authorization": f"Token {api_key}"},
    )

    ws.send(json.dumps(settings))
    print("Settings sent, waiting for agent…")

    try:
        while True:
            raw = ws.recv()
            if isinstance(raw, bytes):
                print(f"  [audio] {len(raw)} bytes")
                continue

            msg = json.loads(raw)
            msg_type = msg.get("type", "")

            if msg_type == "Welcome":
                print(f"  Connected — request_id: {msg.get('request_id')}")
            elif msg_type == "SettingsApplied":
                print("  Settings applied — agent ready")
                print("  (Send audio to interact, or Ctrl+C to stop)")
            elif msg_type == "ConversationText":
                print(f"  [{msg.get('role')}] {msg.get('content')}")
            elif msg_type == "AgentStartedSpeaking":
                latency = msg.get("total_latency", 0)
                print(f"  Agent speaking (latency: {latency:.2f}s)")
            elif msg_type == "AgentAudioDone":
                print("  Agent audio done")
            elif msg_type == "Error":
                print(f"  ERROR: {msg.get('description')} ({msg.get('code')})")
            elif msg_type == "Warning":
                print(f"  WARNING: {msg.get('description')}")
            else:
                print(f"  [{msg_type}] {json.dumps(msg)[:120]}")

    except KeyboardInterrupt:
        print("\nDisconnecting…")
    finally:
        ws.close()


if __name__ == "__main__":
    run_agent()
