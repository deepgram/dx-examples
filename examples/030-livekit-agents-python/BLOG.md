# Building a Voice Assistant using LiveKit Agents and Deepgram

Integrating powerful voice technologies can completely transform how users interact with your applications. This guide will walk you through setting up a minimal yet effective voice assistant using LiveKit Agents, Deepgram for speech-to-text (STT), and OpenAI's GPT for generating responses.

## Why LiveKit Agents?

LiveKit Agents provide a comprehensive platform for managing real-time audio and video communication. By combining it with Deepgram, you can easily add sophisticated STT capabilities to create a seamless voice interaction experience.

## Setting Up the Environment

### Prerequisites

- **Python 3.8+**: Make sure your system is running Python 3.8 or later.
- **LiveKit Server**: Deploy a LiveKit server or use a hosted version.
- **API Keys**: Obtain API keys from Deepgram and OpenAI.

### Environment Variables

To facilitate secure and flexible configuration, store your credentials in environment variables. Create a `.env` file in your project root with the following:

```ini
# LiveKit
LIVEKIT_URL=<your_livekit_url>
LIVEKIT_API_KEY=<your_livekit_api_key>
LIVEKIT_API_SECRET=<your_livekit_api_secret>

# Deepgram
DEEPGRAM_API_KEY=<your_deepgram_api_key>

# OpenAI
OPENAI_API_KEY=<your_openai_api_key>
```

## Developing the Voice Assistant

### 1. Install Dependencies

Ensure your project has the necessary Python packages. Create a `requirements.txt` file and include:

```plaintext
livekit
livekit-plugins-deepgram
openai
python-dotenv
```

Install the dependencies:

```bash
pip install -r requirements.txt
```

### 2. Writing the Agent Code

We start by constructing a minimal agent. Open `agent.py` and import the necessary packages:

```python
import logging
from livekit.agents import Agent, AgentServer, cli, inference
from livekit.plugins.turn_detector.multilingual import MultilingualModel
```

Define a `VoiceAssistant` class extending the `Agent` base class and override critical lifecycle methods like `on_enter`.

```python
class VoiceAssistant(Agent):
    def __init__(self) -> None:
        super().__init__(
            instructions="You are a voice assistant..."
        )

    async def on_enter(self) -> None:
        self.session.generate_reply("Greet the user...")
```

### 3. Configure the Server and Session

Initialize an `AgentServer` and define the session using Deepgram for STT and OpenAI for LLM:

```python
server = AgentServer()

@server.rtc_session()
async def entrypoint(ctx):
    session = AgentSession(
        stt=inference.STT("deepgram/nova-3", language="multi"),
        llm=inference.LLM("openai/gpt-4.1-mini"),
        tts=inference.TTS("cartesia/sonic-3"),
        turn_detection=MultilingualModel(),
        preemptive_generation=True,
    )
    await session.start(agent=VoiceAssistant(), room=ctx.room)
```

### 4. Running Your Agent

Run your agent script to start:

```bash
python src/agent.py
```

Join the LiveKit room specified in your setup to interact with the assistant.

## Conclusion

This example demonstrates how LiveKit Agents integrate seamlessly with Deepgram and OpenAI to power a real-time voice assistant. Experiment by modifying the assistant's behavior or trying different models and configurations.

## What's Next?

- **Explore More Models**: Try different STT and LLM models to see how they change user interactions.
- **Integrate More Features**: Add more sophisticated logic or memory to your assistant for enhanced user experiences.
- **Deploy**: Consider deploying your solution in a production environment for real-world interactions.

---

Leverage the power of voice in your applications with LiveKit and Deepgram for deep transformation of user interactions.