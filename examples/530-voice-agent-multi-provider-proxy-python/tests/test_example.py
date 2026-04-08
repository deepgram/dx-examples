import json
import os
import sys
from pathlib import Path

env_example = Path(__file__).parent.parent / ".env.example"
required = [
    line.split("=")[0].strip()
    for line in env_example.read_text().splitlines()
    if line.strip()
    and not line.startswith("#")
    and "=" in line
    and line[0].isupper()
    and line.split("=", 1)[1].strip() == ""
]
missing = [k for k in required if not os.environ.get(k)]
if missing:
    print(f"MISSING_CREDENTIALS: {','.join(missing)}", file=sys.stderr)
    sys.exit(2)

sys.path.insert(0, str(Path(__file__).parent.parent / "src"))

from fastapi.testclient import TestClient

from proxy import app


def test_health_endpoint():
    """Verify the /health endpoint responds with provider info."""
    client = TestClient(app)
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert "provider" in data
    assert "available_providers" in data
    assert "openai" in data["available_providers"]
    assert "bedrock" in data["available_providers"]
    print("/health endpoint working")


def test_models_endpoint():
    """Verify the /v1/models endpoint responds."""
    client = TestClient(app)
    resp = client.get("/v1/models")
    assert resp.status_code == 200
    data = resp.json()
    assert data["object"] == "list"
    assert len(data["data"]) > 0
    print("/v1/models endpoint working")


def test_chat_completions_missing_messages():
    """Verify the proxy rejects requests with no messages."""
    client = TestClient(app)
    resp = client.post("/v1/chat/completions", json={})
    assert resp.status_code == 400
    assert "messages" in resp.json()["detail"].lower()
    print("Missing messages validation working")


def test_chat_completions_invalid_provider():
    """Verify the proxy rejects unknown providers."""
    client = TestClient(app)
    resp = client.post(
        "/v1/chat/completions",
        json={"messages": [{"role": "user", "content": "hi"}]},
        headers={"X-LLM-Provider": "nonexistent_provider"},
    )
    assert resp.status_code == 400
    assert "nonexistent_provider" in resp.json()["detail"]
    print("Invalid provider validation working")


def test_chat_completions_openai():
    """Verify the proxy routes to OpenAI and returns a valid OpenAI-format response.

    This exercises the full request path: FastAPI endpoint -> provider dispatch
    -> OpenAI API -> response reformatting. The transcript is non-deterministic
    so we only assert on response structure.
    """
    client = TestClient(app)
    resp = client.post(
        "/v1/chat/completions",
        json={
            "messages": [
                {"role": "system", "content": "Reply with exactly one word."},
                {"role": "user", "content": "Say hello."},
            ],
            "model": "gpt-4o-mini",
        },
        headers={"X-LLM-Provider": "openai"},
    )
    assert resp.status_code == 200, f"Unexpected status: {resp.status_code} — {resp.text}"
    data = resp.json()

    assert "choices" in data, "Response missing 'choices'"
    assert len(data["choices"]) > 0, "Empty choices array"
    assert "message" in data["choices"][0], "Choice missing 'message'"
    content = data["choices"][0]["message"]["content"]
    assert len(content.strip()) > 0, "Empty response content"
    assert "usage" in data, "Response missing 'usage'"
    assert data["usage"]["total_tokens"] > 0, "Token count should be positive"

    print("OpenAI provider working")
    print(f"  Response: '{content[:80]}'")
    print(f"  Tokens: {data['usage']['total_tokens']}")


def test_provider_header_override():
    """Verify X-LLM-Provider header overrides the env default."""
    client = TestClient(app)
    resp = client.post(
        "/v1/chat/completions",
        json={
            "messages": [
                {"role": "user", "content": "Say ok."},
            ],
            "model": "gpt-4o-mini",
        },
        headers={"X-LLM-Provider": "openai"},
    )
    assert resp.status_code == 200
    data = resp.json()
    assert "choices" in data
    print("Provider header override working")


def test_voice_agent_settings_builder():
    """Verify build_settings() produces a valid Voice Agent Settings message."""
    from demo_agent import build_settings

    settings = build_settings("http://localhost:8080/v1/chat/completions")

    assert settings["type"] == "Settings"
    assert settings["audio"]["input"]["encoding"] == "linear16"
    assert settings["audio"]["input"]["sample_rate"] == 16000
    assert settings["agent"]["listen"]["provider"]["type"] == "deepgram"
    assert settings["agent"]["listen"]["provider"]["model"] == "nova-3"
    assert settings["agent"]["think"]["provider"]["type"] == "open_ai"
    assert settings["agent"]["think"]["endpoint"]["url"] == "http://localhost:8080/v1/chat/completions"
    assert settings["agent"]["speak"]["provider"]["type"] == "deepgram"
    assert "prompt" in settings["agent"]["think"]

    print("Voice Agent settings builder working")


def test_voice_agent_accepts_custom_endpoint_settings():
    """Verify the Voice Agent WebSocket accepts Settings with think.endpoint.

    Connects to the real Deepgram Voice Agent API with think.endpoint.url
    pointing to a custom HTTPS endpoint and confirms SettingsApplied.
    The endpoint uses OpenAI's real URL to pass validation — in production
    this would be your deployed proxy URL.
    """
    import websockets.sync.client

    from demo_agent import DG_AGENT_URL

    api_key = os.environ["DEEPGRAM_API_KEY"]

    settings = {
        "type": "Settings",
        "audio": {
            "input": {"encoding": "linear16", "sample_rate": 16000},
            "output": {"encoding": "linear16", "sample_rate": 16000},
        },
        "agent": {
            "listen": {"provider": {"type": "deepgram", "model": "nova-3"}},
            "think": {
                "provider": {"type": "open_ai", "model": "gpt-4o-mini"},
                "endpoint": {
                    "url": "https://api.openai.com/v1/chat/completions",
                    "headers": {
                        "Authorization": f"Bearer {os.environ.get('OPENAI_API_KEY', '')}",
                    },
                },
                "prompt": "Say hello.",
            },
            "speak": {"provider": {"type": "deepgram", "model": "aura-2-thalia-en"}},
        },
    }

    ws = websockets.sync.client.connect(
        DG_AGENT_URL,
        additional_headers={"Authorization": f"Token {api_key}"},
        open_timeout=10,
    )

    try:
        ws.send(json.dumps(settings))

        got_welcome = False
        got_settings_applied = False

        for _ in range(30):
            try:
                raw = ws.recv(timeout=5)
            except TimeoutError:
                break
            if isinstance(raw, bytes):
                continue
            msg = json.loads(raw)
            if msg.get("type") == "Welcome":
                got_welcome = True
            elif msg.get("type") == "SettingsApplied":
                got_settings_applied = True
                break
            elif msg.get("type") == "Error":
                raise AssertionError(f"Agent error: {msg.get('description')}")

        assert got_welcome, "Never received Welcome message"
        assert got_settings_applied, "Never received SettingsApplied message"
        print("Voice Agent accepted custom endpoint settings — SettingsApplied received")

    finally:
        ws.close()


if __name__ == "__main__":
    test_health_endpoint()
    test_models_endpoint()
    test_chat_completions_missing_messages()
    test_chat_completions_invalid_provider()
    test_chat_completions_openai()
    test_provider_header_override()
    test_voice_agent_settings_builder()
    test_voice_agent_accepts_custom_endpoint_settings()
    print("\nAll tests passed")
