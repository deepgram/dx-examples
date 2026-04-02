# Vapi.ai Voice Agent with Deepgram STT & TTS

Build a production-ready voice agent on Vapi.ai using Deepgram as the speech-to-text and text-to-speech provider. This example shows how to configure Deepgram-specific settings for optimal quality and latency, handle server-side function calls via webhooks, and manage the full conversation lifecycle.

## What you'll build

A TypeScript server that creates a Vapi voice assistant powered by Deepgram nova-3 (STT) and aura-2 (TTS), with an Express webhook endpoint that handles real-time function calls — in this case, a pizza order status lookup.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- Vapi.ai account — [sign up](https://dashboard.vapi.ai/)
- A tunnel tool for local development (e.g. [ngrok](https://ngrok.com/) or [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/))

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `VAPI_API_KEY` | [Vapi dashboard → Organization Settings → API Keys](https://dashboard.vapi.ai/) |

## Install and run

```bash
cp .env.example .env
# Fill in DEEPGRAM_API_KEY and VAPI_API_KEY

npm install
npm run build

# 1. Create the assistant (one-time setup)
npm run create-assistant
# Copy the assistant ID and add VAPI_ASSISTANT_ID to .env

# 2. Start the webhook server
npm start

# 3. Expose your server (in another terminal)
ngrok http 3000

# 4. Update VAPI_SERVER_URL in .env with your ngrok URL + /webhook
#    Then re-create the assistant or update it in the Vapi dashboard

# 5. Make a test call from the Vapi dashboard or:
curl -X POST http://localhost:3000/call \
  -H "Content-Type: application/json" \
  -d '{"assistantId": "your-assistant-id"}'
```

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `transcriber.provider` | `deepgram` | Uses Deepgram for speech-to-text |
| `transcriber.model` | `nova-3` | Latest and most accurate Deepgram STT model |
| `transcriber.endpointing` | `255` | Milliseconds of silence before end-of-turn detection |
| `voice.provider` | `deepgram` | Uses Deepgram for text-to-speech |
| `voice.voiceId` | `aura-2-thalia-en` | Natural-sounding female English voice |
| `model.provider` | `openai` | LLM provider for generating responses |
| `model.model` | `gpt-4o-mini` | Fast, cost-effective model for conversational AI |

## How it works

1. **`create-assistant.ts`** provisions a Vapi assistant via the server SDK, configuring Deepgram as both the STT transcriber (nova-3) and TTS voice (aura-2-thalia-en), plus an OpenAI LLM with a system prompt and function definitions.

2. **`index.ts`** runs an Express server with a `/webhook` endpoint. When a call connects, Vapi streams audio to Deepgram for transcription, feeds the text to the LLM, and synthesises responses with Deepgram TTS — all managed by Vapi's infrastructure.

3. When the LLM decides to call a function (e.g. `check_order_status`), Vapi sends a `function-call` event to your webhook. Your server executes the logic and returns the result, which the LLM uses to continue the conversation.

4. At the end of the call, Vapi sends an `end-of-call-report` with duration, cost, and a full transcript.

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
