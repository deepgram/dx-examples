"""
Platform-agnostic LLM client for the engineering pipeline.

Pure stdlib HTTP — no provider SDKs.

Config (three env vars, provider-agnostic):
  LLM_API_KEY   — API key
  LLM_BASE_URL  — Base URL e.g. https://api.openai.com/v1
  LLM_MODEL     — Model name
  LLM_TIMEOUT   — Seconds (default 120)

The module detects the provider from LLM_BASE_URL and formats the request
accordingly. Supports any OpenAI-compatible endpoint.

No dependencies. No install step. Works everywhere.
"""

import os
import json
import urllib.request

API_KEY = os.environ.get("LLM_API_KEY", "")
BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
MODEL = os.environ.get("LLM_MODEL", "gpt-5.4")
TIMEOUT = int(os.environ.get("LLM_TIMEOUT", "120"))

if not API_KEY:
    raise ValueError("LLM_API_KEY not set")


def _detect_provider() -> str:
    url = BASE_URL.lower()
    if "anthropic" in url:
        return "anthropic"
    return "openai"


def _to_openai_schema(tool: dict) -> dict:
    props = {}
    required = tool.get("input_schema", {}).get("required", [])
    for name, spec in tool.get("input_schema", {}).get("properties", {}).items():
        type_map = {
            "string": "string",
            "integer": "integer",
            "number": "number",
            "boolean": "boolean",
            "object": "object",
            "array": "array",
        }
        props[name] = {
            "type": type_map.get(spec.get("type", "string"), "string"),
            "description": spec.get("description", ""),
        }
    return {
        "name": tool["name"],
        "description": tool.get("description", ""),
        "parameters": {"type": "object", "properties": props, "required": required},
    }


def messages_create(
    model: str,
    max_tokens: int,
    system: str,
    tools: list,
    messages: list,
) -> dict:
    """
    Send a messages API call and return a normalised dict with:
      - text:        str  — assistant text content
      - stop_reason: str  — "tool_use" | "end_turn" | "max_tokens"
      - blocks:      list — [{"type": "text"|"tool_use", ...}]
      - raw:         dict — raw API response for debugging
    """
    provider = _detect_provider()

    if provider == "anthropic":
        return _anthropic_create(model, max_tokens, system, tools, messages)

    payload = {
        "model": model,
        "max_completion_tokens": max_tokens,
        "messages": [{"role": "system", "content": system}] + messages,
    }
    if tools:
        payload["tools"] = [
            {"type": "function", "function": _to_openai_schema(t)} for t in tools
        ]
        payload["tool_choice"] = "auto"

    return _openai_normalise(_post(f"{BASE_URL}/chat/completions", payload))


def _anthropic_create(model, max_tokens, system, tools, messages) -> dict:
    anthropic_messages = []
    for m in messages:
        role = "user" if m["role"] == "user" else "assistant"
        content = m["content"]
        if isinstance(content, list):
            parts = []
            for part in content:
                if part["type"] == "text":
                    parts.append({"type": "text", "text": part["text"]})
                elif part["type"] == "tool_result":
                    parts.append({
                        "type": "tool_result",
                        "tool_use_id": part["tool_use_id"],
                        "content": part["content"],
                    })
            anthropic_messages.append({"role": role, "content": parts})
        else:
            anthropic_messages.append({"role": role, "content": content})

    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "system": system,
        "messages": anthropic_messages,
    }
    if tools:
        payload["tools"] = [_to_openai_schema(t) for t in tools]

    # Anthropic uses /v1/messages, not /v1/chat/completions
    endpoint = BASE_URL + "/messages"
    return _anthropic_normalise(_post(endpoint, payload))


def _post(url: str, payload: dict) -> dict:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
            return json.loads(resp.read())
    except urllib.error.HTTPError as e:
        body_text = e.read().decode("utf-8", errors="replace")
        raise Exception(f"HTTP {e.code} {e.reason} on {url}\nBody: {body_text[:1000]}") from e


def _openai_normalise(data: dict) -> dict:
    msg = data["choices"][0]["message"]
    stop_raw = data["choices"][0].get("finish_reason", "stop")

    stop_reason = "end_turn"
    if stop_raw in ("tool_calls", "function_call"):
        stop_reason = "tool_use"
    elif stop_raw in ("length", "max_tokens"):
        stop_reason = "max_tokens"

    blocks = []
    if msg.get("content"):
        blocks.append({"type": "text", "text": msg["content"]})
    for tc in msg.get("tool_calls") or []:
        blocks.append({
            "type": "tool_use",
            "name": tc["function"]["name"],
            "input": json.loads(tc["function"]["arguments"]),
            "id": tc["id"],
        })

    return {
        "text": msg.get("content") or "",
        "stop_reason": stop_reason,
        "blocks": blocks,
        "raw": data,
    }


def _anthropic_normalise(data: dict) -> dict:
    blocks = []
    text_content = ""
    for block in data.get("content", []):
        if block["type"] == "text":
            text_content = block["text"]
            blocks.append({"type": "text", "text": block["text"]})
        elif block["type"] == "tool_use":
            blocks.append({
                "type": "tool_use",
                "name": block["name"],
                "input": block["input"],
                "id": block["id"],
            })

    raw_stop = data.get("stop_reason", "")
    if raw_stop == "tool_use":
        stop_reason = "tool_use"
    elif raw_stop in ("max_tokens", "max_output_tokens"):
        stop_reason = "max_tokens"
    else:
        stop_reason = "end_turn"

    return {
        "text": text_content,
        "stop_reason": stop_reason,
        "blocks": blocks,
        "raw": data,
    }


def response_text(response: dict) -> str:
    return response["text"]


def response_stop_reason(response: dict) -> str:
    return response["stop_reason"]


def extract_blocks(response: dict) -> list:
    return response["blocks"]


def wrap_message(role: str, content) -> dict:
    if isinstance(content, list):
        return {"role": role, "content": content}
    return {"role": role, "content": content}


def wrap_tool_result(tool_use_id: str, content: str) -> dict:
    return {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}
