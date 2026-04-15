"""
Unified LLM client for the engineering pipeline.

Set LLM_PROVIDER env var to switch between:
  anthropic  (default) — Anthropic API
  openai     — OpenAI API (compatible with Azure OpenAI, Grok, etc.)
  gemini     — Google AI / Vertex AI (Gemini models)

Usage:
    from llm import client, MODEL, MODEL_TYPE

    response = client.messages.create(
        model=MODEL,
        ...
    )
"""

import os
import json
import subprocess

PROVIDER = os.environ.get("LLM_PROVIDER", "anthropic").lower()
MODEL = os.environ.get("LLM_MODEL", "")

# ---------------------------------------------------------------------------
# Provider detection
# ---------------------------------------------------------------------------

if PROVIDER == "openai":
    try:
        from openai import OpenAI
    except ImportError:
        subprocess.run(["pip", "install", "openai", "--quiet"], check=True)
        from openai import OpenAI

    _api_key = os.environ.get("OPENAI_API_KEY")
    if not _api_key:
        raise ValueError("OPENAI_API_KEY not set — cannot use openai provider")

    _base_url = os.environ.get("OPENAI_BASE_URL", "")
    client_kwargs = {"api_key": _api_key}
    if _base_url:
        client_kwargs["base_url"] = _base_url

    client = OpenAI(**client_kwargs)

    if not MODEL:
        MODEL = os.environ.get("OPENAI_MODEL", "gpt-4o")

    MODEL_TYPE = "openai"

    def messages_create(model: str, max_tokens: int, system: str, tools: list, messages: list):
        return client.chat.completions.create(
            model=model,
            max_tokens=max_tokens,
            messages=[{"role": "system", "content": system}] + messages,
            tools=[{"type": "function", "function": _to_openai_schema(t)} for t in tools] if tools else None,
            tool_choice="auto",
            stream=False,
        )

    def _to_openai_schema(tool: dict) -> dict:
        props = {}
        required = tool.get("input_schema", {}).get("required", [])
        for name, spec in tool.get("input_schema", {}).get("properties", {}).items():
            type_map = {"string": "string", "integer": "integer", "number": "number", "boolean": "boolean", "object": "object", "array": "array"}
            props[name] = {"type": type_map.get(spec.get("type", "string"), "string"), "description": spec.get("description", "")}
        return {"name": tool["name"], "description": tool.get("description", ""), "parameters": {"type": "object", "properties": props, "required": required}}

    def response_text(response) -> str:
        return response.choices[0].message.content or ""

    def response_tool_calls(response) -> list:
        return [
            {"name": tc.function.name, "input": json.loads(tc.function.arguments), "id": tc.id}
            for tc in (response.choices[0].message.tool_calls or [])
        ]

    def response_stop_reason(response) -> str:
        delta = response.choices[0].finish_reason
        if delta == "tool_calls":
            return "tool_use"
        if delta == "length":
            return "max_tokens"
        return delta or "end_turn"

    def wrap_message(role: str, content) -> dict:
        if isinstance(content, list):
            return {"role": role, "content": content}
        return {"role": role, "content": content}

    def wrap_tool_result(tool_use_id: str, content: str) -> dict:
        return {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}

    def extract_blocks(response):
        blocks = []
        msg = response.choices[0].message
        if msg.content:
            blocks.append({"type": "text", "text": msg.content})
        for tc in (msg.tool_calls or []):
            blocks.append({"type": "tool_use", "name": tc.function.name, "input": json.loads(tc.function.arguments), "id": tc.id})
        return blocks

    MODEL_TYPE = "openai"

elif PROVIDER == "gemini":
    try:
        import google.genai as genai
    except ImportError:
        subprocess.run(["pip", "install", "google-genai", "--quiet"], check=True)
        import google.genai as genai

    _api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("VERTEX_AI_API_KEY")
    if not _api_key:
        raise ValueError("GEMINI_API_KEY or VERTEX_AI_API_KEY not set — cannot use gemini provider")

    genai_client = genai.Client(api_key=_api_key)

    if not MODEL:
        MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-pro-preview-05-13")

    MODEL_TYPE = "gemini"

    def messages_create(model: str, max_tokens: int, system: str, tools: list, messages: list):
        _sys_parts = [{"text": system}] if system else []
        _msg_parts = []
        for msg in messages:
            role = "model" if msg["role"] == "assistant" else "user"
            content = msg["content"]
            if isinstance(content, str):
                _msg_parts.append({"role": role, "parts": [{"text": content}]})
            elif isinstance(content, list):
                _parts = []
                for part in content:
                    if part["type"] == "text":
                        _parts.append({"text": part["text"]})
                    elif part["type"] == "tool_result":
                        _parts.append({"functionResponse": {"name": part.get("name", "unknown"), "raw_response": part["content"]}})
                _msg_parts.append({"role": role, "parts": _parts})
        config = {"generation_config": {"max_output_tokens": max_tokens}}
        if tools:
            from google.genai import types
            _tools = [types.Tool(declarations=[types.FunctionDeclaration(name=t["name"], description=t.get("description",""), parameters=t.get("input_schema",{})) for t in tools])]
            config["tools"] = _tools
        return genai_client.models.generate_content(model=model, contents=_msg_parts, system_instruction=_sys_parts, **config)

    def response_text(response) -> str:
        return response.text or ""

    def response_tool_calls(response) -> list:
        calls = []
        for candidate in (response.candidates or []):
            for part in (candidate.content.parts or []):
                if part.function_call:
                    calls.append({"name": part.function_call.name, "input": dict(part.function_call.args), "id": f"call_{calls.__len__()}"})
        return calls

    def response_stop_reason(response) -> str:
        cand = (response.candidates or [None])[0]
        if not cand:
            return "end_turn"
        finish = str(cand.finish_reason or "")
        if "MAX_TOKENS" in finish:
            return "max_tokens"
        if "STOP" in finish or "END" in finish:
            return "end_turn"
        return "tool_use"

    def wrap_message(role: str, content) -> dict:
        return {"role": role, "content": content}

    def wrap_tool_result(tool_use_id: str, content: str) -> dict:
        return {"content": content}

    def extract_blocks(response):
        blocks = []
        if response.text:
            blocks.append({"type": "text", "text": response.text})
        for candidate in (response.candidates or []):
            for part in (candidate.content.parts or []):
                if part.function_call:
                    blocks.append({"type": "tool_use", "name": part.function_call.name, "input": dict(part.function_call.args), "id": f"call_{len(blocks)}"})
        return blocks

    client = None  # gemini uses genai_client internally; expose None for compat

else:
    # Default: Anthropic
    try:
        import anthropic
    except ImportError:
        subprocess.run(["pip", "install", "anthropic", "--quiet"], check=True)
        import anthropic

    _api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not _api_key:
        raise ValueError("ANTHROPIC_API_KEY not set — cannot use anthropic provider")

    client = anthropic.Anthropic(api_key=_api_key)

    if not MODEL:
        MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-opus-4-5")

    MODEL_TYPE = "anthropic"

    def messages_create(model: str, max_tokens: int, system: str, tools: list, messages: list):
        kwargs = {"model": model, "max_tokens": max_tokens, "system": system, "messages": messages}
        if tools:
            kwargs["tools"] = tools
        return client.messages.create(**kwargs)

    def response_text(response) -> str:
        for block in response.content:
            if block.type == "text":
                return block.text
        return ""

    def response_tool_calls(response) -> list:
        return [
            {"name": b.name, "input": b.input, "id": b.id}
            for b in response.content
            if b.type == "tool_use"
        ]

    def response_stop_reason(response) -> str:
        return response.stop_reason or "end_turn"

    def wrap_message(role: str, content) -> dict:
        return {"role": role, "content": content}

    def wrap_tool_result(tool_use_id: str, content: str) -> dict:
        return {"type": "tool_result", "tool_use_id": tool_use_id, "content": content}

    def extract_blocks(response):
        return response.content
