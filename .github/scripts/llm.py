"""
Platform-agnostic LLM client for the engineering pipeline.

Pure stdlib HTTP — no provider SDKs. Every LLM provider (OpenAI, Azure, Anthropic,
Grok, Vertex AI, Ollama, LM Studio, etc.) exposes an OpenAI-compatible
`/v1/chat/completions` endpoint. This module uses that standard exclusively.

Configure via env vars:
  LLM_API_KEY      — API key for the provider
  LLM_BASE_URL     — Base URL (default: https://api.openai.com/v1)
  LLM_MODEL        — Model name (default: gpt-5.4)
  LLM_TIMEOUT      — Request timeout in seconds (default: 120)

No dependencies. No install step. Works everywhere.
"""

import os
import json
import urllib.request


API_KEY = os.environ.get("LLM_API_KEY", os.environ.get("OPENAI_API_KEY", ""))
BASE_URL = os.environ.get("LLM_BASE_URL", "https://api.openai.com/v1").rstrip("/")
MODEL = os.environ.get("LLM_MODEL", "gpt-5.4")
TIMEOUT = int(os.environ.get("LLM_TIMEOUT", "120"))


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
    payload = {
        "model": model,
        "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": system}] + messages,
    }
    if tools:
        payload["tools"] = [
            {"type": "function", "function": _to_openai_schema(t)} for t in tools
        ]
        payload["tool_choice"] = "auto"

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        f"{BASE_URL}/chat/completions",
        data=body,
        headers={
            "Authorization": f"Bearer {API_KEY}",
            "Content-Type": "application/json",
        },
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=TIMEOUT) as resp:
        data = json.loads(resp.read())

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
