# LangChain STT Tool — Transcribe Audio in AI Pipelines

Use Deepgram speech-to-text as a LangChain tool so your LLM agents can transcribe audio on demand. Give an agent an audio URL and a question — it transcribes the recording, then reasons over the transcript to answer.

## What you'll build

A Python script with two modes: (1) a standalone CLI that transcribes any audio URL via Deepgram nova-3, and (2) a LangChain agent that uses the transcription tool as part of its reasoning — for example, "Transcribe this meeting recording and list the action items."

## Prerequisites

- Python 3.10+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- OpenAI account (for agent mode only) — [get an API key](https://platform.openai.com/api-keys)

## Environment variables

| Variable | Where to find it | Required for |
|----------|-----------------|-------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) | Both modes |
| `OPENAI_API_KEY` | [OpenAI dashboard](https://platform.openai.com/api-keys) | Agent mode only |

Copy `.env.example` to `.env` and fill in your values.

## Install and run

```bash
pip install -r requirements.txt

# Standalone — transcribe an audio URL directly
python src/transcribe_tool.py https://dpgr.am/spacewalk.wav

# Agent mode — let the LLM decide when to transcribe
python src/transcribe_tool.py --agent "Transcribe https://dpgr.am/spacewalk.wav and summarise the key points"
```

## How it works

1. The `@tool` decorator from `langchain_core.tools` wraps a plain Python function into a LangChain tool with auto-generated schema from type hints
2. When called, the tool sends the audio URL to Deepgram's pre-recorded API (`transcribe_url`) — Deepgram fetches the audio server-side
3. nova-3 with `smart_format=True` returns punctuated, formatted text
4. In agent mode, `create_tool_calling_agent` binds the tool to OpenAI's function-calling API — the LLM sees the tool's schema, decides when to call it, receives the transcript, then generates a final answer

## Extending this example

- **Add more tools** — combine with a summarisation tool, a search tool, or a database lookup
- **Swap the LLM** — replace `ChatOpenAI` with any LangChain-compatible chat model (Anthropic, Google, local models via Ollama)
- **Use in a RAG pipeline** — transcribe audio, chunk it, embed it, and use it for retrieval-augmented generation
- **Batch processing** — loop over a list of audio URLs and transcribe them all

## Related

- [Deepgram pre-recorded STT docs](https://developers.deepgram.com/docs/pre-recorded-audio)
- [Deepgram Python SDK](https://github.com/deepgram/deepgram-python-sdk)
- [LangChain custom tools](https://python.langchain.com/docs/how_to/custom_tools/)
- [LangChain tool-calling agents](https://python.langchain.com/docs/how_to/agent_executor/)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
