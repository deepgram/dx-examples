"""OpenAI-compatible chat completions proxy that routes to multiple LLM backends.

The Deepgram Voice Agent API lets you specify a custom LLM endpoint via
think.endpoint.url. This server exposes POST /v1/chat/completions in the
OpenAI format so the Voice Agent can use any backend (OpenAI, AWS Bedrock)
without changing application code — just swap LLM_PROVIDER in your env.

Usage:
    uvicorn src.proxy:app --port 8080

Then configure the Voice Agent to use this proxy:
    think.endpoint.url = "https://your-proxy.example.com/v1/chat/completions"
    think.provider.type = "open_ai"
"""

from __future__ import annotations

import os

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

load_dotenv()

from providers import PROVIDERS, get_provider

app = FastAPI(
    title="Multi-Provider Chat Completions Proxy",
    description=(
        "OpenAI-compatible /v1/chat/completions endpoint that routes to "
        "multiple LLM providers. Designed as the think.provider.url target "
        "for the Deepgram Voice Agent API."
    ),
    version="1.0.0",
)


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    """OpenAI-compatible chat completions endpoint.

    Reads LLM_PROVIDER from env (or X-LLM-Provider header) to decide which
    backend handles the request. The request/response format matches OpenAI's
    API so the Deepgram Voice Agent can use it as a drop-in replacement.
    """
    body = await request.json()

    provider_name = (
        request.headers.get("X-LLM-Provider")
        or os.environ.get("LLM_PROVIDER", "openai")
    )

    try:
        provider_fn = get_provider(provider_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    messages = body.get("messages", [])
    if not messages:
        raise HTTPException(status_code=400, detail="messages is required")

    model = body.get("model", "gpt-4o-mini")
    extra_kwargs = {}
    if "temperature" in body:
        extra_kwargs["temperature"] = body["temperature"]
    if "max_tokens" in body:
        extra_kwargs["max_tokens"] = body["max_tokens"]
    if "tools" in body:
        extra_kwargs["tools"] = body["tools"]
    if "tool_choice" in body:
        extra_kwargs["tool_choice"] = body["tool_choice"]

    try:
        result = provider_fn(messages=messages, model=model, **extra_kwargs)
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"Provider error: {exc}")

    return JSONResponse(content=result)


@app.get("/v1/models")
async def list_models():
    """Minimal models endpoint so clients can verify connectivity."""
    return {
        "object": "list",
        "data": [
            {"id": "proxy", "object": "model", "owned_by": "proxy"},
        ],
    }


@app.get("/health")
async def health():
    """Health check endpoint."""
    provider = os.environ.get("LLM_PROVIDER", "openai")
    return {
        "status": "ok",
        "provider": provider,
        "available_providers": list(PROVIDERS.keys()),
    }
