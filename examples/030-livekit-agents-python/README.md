# LiveKit Agents — Voice Assistant with Deepgram STT

Build a real-time voice AI assistant using LiveKit's agent framework with Deepgram nova-3 for speech-to-text. The agent joins a LiveKit room, listens to participants via WebRTC, transcribes speech with Deepgram, generates responses with an LLM, and speaks back with TTS.

## What you'll build

A Python voice agent that runs as a LiveKit worker process. When a user joins a LiveKit room, the agent automatically connects, greets the user, and holds a natural voice conversation — transcribing speech with Deepgram nova-3, thinking with OpenAI GPT-4.1-mini, and responding with Cartesia TTS. You can test it locally with `python src/agent.py console` for a terminal-based voice interaction.

## Prerequisites

- Python 3.10+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- LiveKit Cloud account or self-hosted LiveKit server — [sign up](https://cloud.livekit.io/)
- OpenAI API key — [get one](https://platform.openai.com/api-keys)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `LIVEKIT_URL` | [LiveKit Cloud dashboard](https://cloud.livekit.io/) → Project Settings |
| `LIVEKIT_API_KEY` | [LiveKit Cloud dashboard](https://cloud.livekit.io/) → API Keys |
| `LIVEKIT_API_SECRET` | [LiveKit Cloud dashboard](https://cloud.livekit.io/) → API Keys |
| `OPENAI_API_KEY` | [OpenAI dashboard](https://platform.openai.com/api-keys) |

Copy `.env.example` to `.env` and fill in your values.

## Install and run

```bash
pip install -r requirements.txt

# Download VAD and turn detector model files (first time only)
python src/agent.py download-files

# Run in console mode (talk from your terminal)
python src/agent.py console

# Or run as a dev worker (connects to LiveKit server)
python src/agent.py dev
```

## How it works

1. The agent registers as a LiveKit worker and waits for room sessions
2. When a participant joins, the `entrypoint` function creates an `AgentSession` wired to Deepgram STT, OpenAI LLM, and Cartesia TTS
3. LiveKit captures the participant's microphone audio over WebRTC
4. Audio passes through Silero VAD (voice activity detection) → Deepgram nova-3 STT → OpenAI GPT-4.1-mini → Cartesia TTS
5. The synthesized response audio streams back to the participant in real-time
6. The multilingual turn detector decides when the user has finished speaking, enabling natural back-and-forth conversation

## Related

- [LiveKit Agents docs](https://docs.livekit.io/agents/)
- [LiveKit Deepgram STT plugin](https://docs.livekit.io/agents/integrations/stt/deepgram/)
- [Deepgram nova-3 model docs](https://developers.deepgram.com/docs/models)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
