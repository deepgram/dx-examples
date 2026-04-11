# Multi-Provider Chat Completions Proxy for Deepgram Voice Agent

A FastAPI proxy server that exposes an OpenAI-compatible `/v1/chat/completions` endpoint, routing requests to multiple LLM backends (OpenAI, AWS Bedrock). The Deepgram Voice Agent API uses this proxy as its `think.endpoint.url`, letting you swap LLM providers without changing application code.

## What you'll build

A Python proxy server that sits between the Deepgram Voice Agent API and your choice of LLM backend. The Voice Agent handles speech-to-text (nova-3) and text-to-speech (aura-2) while all "thinking" routes through your proxy to OpenAI or AWS Bedrock — switchable via a single environment variable.

## Prerequisites

- Python 3.10+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- OpenAI account — [get an API key](https://platform.openai.com/api-keys)
- AWS account (optional, for Bedrock) — [IAM console](https://console.aws.amazon.com/iam/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `LLM_PROVIDER` | Set to `openai` or `bedrock` (default: `openai`) |
| `OPENAI_API_KEY` | [OpenAI dashboard → API keys](https://platform.openai.com/api-keys) |
| `AWS_ACCESS_KEY_ID` | [AWS IAM console](https://console.aws.amazon.com/iam/) (Bedrock only) |
| `AWS_SECRET_ACCESS_KEY` | [AWS IAM console](https://console.aws.amazon.com/iam/) (Bedrock only) |
| `AWS_REGION` | AWS region with Bedrock access, e.g. `us-east-1` (Bedrock only) |

## Install and run

```bash
cp .env.example .env
# Fill in your API keys in .env

pip install -r requirements.txt

# Start the proxy server
cd src && uvicorn proxy:app --port 8080

# In another terminal, run the demo Voice Agent
python src/demo_agent.py
```

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `think.provider.type` | `open_ai` | Tells the Voice Agent to use OpenAI-compatible format |
| `think.endpoint.url` | `https://your-proxy.example.com/v1/chat/completions` | Points the agent's LLM calls at the proxy (must be HTTPS) |
| `listen.provider.model` | `nova-3` | Deepgram's flagship STT model |
| `speak.provider.model` | `aura-2-thalia-en` | Deepgram's TTS model |
| `LLM_PROVIDER` | `openai` or `bedrock` | Which backend the proxy routes to |

## How it works

1. **Start the proxy** — FastAPI serves `/v1/chat/completions` on port 8080
2. **Connect the Voice Agent** — The demo script opens a WebSocket to `wss://agent.deepgram.com/v1/agent/converse` with `think.endpoint.url` pointed at the proxy
3. **User speaks** — The Voice Agent transcribes speech using Deepgram nova-3
4. **Agent thinks** — The Voice Agent sends an OpenAI-format chat completion request to the proxy
5. **Proxy routes** — Based on `LLM_PROVIDER` (or the `X-LLM-Provider` header), the proxy forwards to OpenAI or AWS Bedrock
6. **Agent speaks** — The Voice Agent converts the LLM response to speech using Deepgram aura-2 and streams audio back

To switch providers, change `LLM_PROVIDER` in your `.env` — no code changes needed. You can also override per-request using the `X-LLM-Provider: bedrock` header.

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
