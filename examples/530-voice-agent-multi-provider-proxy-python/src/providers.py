"""LLM provider backends for the OpenAI-compatible proxy.

Each provider implements chat_completion() which accepts OpenAI-format messages
and returns an OpenAI-format response dict. This keeps the proxy layer thin —
adding a new provider means writing one function.
"""

from __future__ import annotations

import os
import time
import uuid
from typing import Any

import httpx


def openai_completion(
    messages: list[dict[str, Any]],
    model: str = "gpt-4o-mini",
    **kwargs: Any,
) -> dict[str, Any]:
    """Forward the request to OpenAI's chat completions API."""
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY not set")

    payload: dict[str, Any] = {"model": model, "messages": messages, **kwargs}

    resp = httpx.post(
        "https://api.openai.com/v1/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json=payload,
        timeout=60.0,
    )
    resp.raise_for_status()
    return resp.json()


def bedrock_completion(
    messages: list[dict[str, Any]],
    model: str = "anthropic.claude-3-haiku-20240307-v1:0",
    **kwargs: Any,
) -> dict[str, Any]:
    """Forward the request to AWS Bedrock's Converse API and reformat as OpenAI."""
    try:
        import boto3
    except ImportError as exc:
        raise RuntimeError("boto3 is required for the bedrock provider") from exc

    region = os.environ.get("AWS_REGION", "us-east-1")
    client = boto3.client(
        "bedrock-runtime",
        region_name=region,
        aws_access_key_id=os.environ.get("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.environ.get("AWS_SECRET_ACCESS_KEY"),
    )

    bedrock_messages = []
    system_prompt = None
    for msg in messages:
        if msg["role"] == "system":
            system_prompt = msg["content"]
            continue
        bedrock_messages.append({
            "role": msg["role"],
            "content": [{"text": msg["content"]}],
        })

    converse_kwargs: dict[str, Any] = {
        "modelId": model,
        "messages": bedrock_messages,
    }
    if system_prompt:
        converse_kwargs["system"] = [{"text": system_prompt}]

    response = client.converse(**converse_kwargs)

    output_text = ""
    if response.get("output", {}).get("message", {}).get("content"):
        for block in response["output"]["message"]["content"]:
            if "text" in block:
                output_text += block["text"]

    usage = response.get("usage", {})
    return {
        "id": f"chatcmpl-{uuid.uuid4().hex[:12]}",
        "object": "chat.completion",
        "created": int(time.time()),
        "model": model,
        "choices": [
            {
                "index": 0,
                "message": {"role": "assistant", "content": output_text},
                "finish_reason": response.get("stopReason", "end_turn"),
            }
        ],
        "usage": {
            "prompt_tokens": usage.get("inputTokens", 0),
            "completion_tokens": usage.get("outputTokens", 0),
            "total_tokens": usage.get("inputTokens", 0) + usage.get("outputTokens", 0),
        },
    }


PROVIDERS = {
    "openai": openai_completion,
    "bedrock": bedrock_completion,
}


def get_provider(name: str):
    """Return the completion function for the named provider."""
    fn = PROVIDERS.get(name)
    if fn is None:
        raise ValueError(f"Unknown provider '{name}'. Available: {list(PROVIDERS.keys())}")
    return fn
