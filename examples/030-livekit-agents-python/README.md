# LiveKit Voice Assistant with Deepgram

![Screenshot](./screenshot.png)

This example demonstrates how to build a minimal voice assistant using LiveKit Agents and Deepgram. It uses the LiveKit declarative pipeline to integrate speech-to-text (STT) from Deepgram, language processing from OpenAI's GPT, and optional text-to-speech (TTS) via Cartesia Sonic.

## Prerequisites

- Python 3.8+
- A LiveKit server with API credentials
- Deepgram API key
- OpenAI API key

## Environment Variables

Create a `.env` file in the project root or set these environment variables directly:

```ini
# LiveKit
LIVEKIT_URL=           # Your LiveKit server URL
LIVEKIT_API_KEY=       # Your LiveKit API key
LIVEKIT_API_SECRET=    # Your LiveKit API secret

# Deepgram 
DEEPGRAM_API_KEY=      # Your Deepgram API key

# OpenAI
OPENAI_API_KEY=        # Your OpenAI API key
```

## Running the Example

1. **Install Dependencies**

   Ensure you have the required Python packages:

   ```bash
   pip install -r requirements.txt
   ```

2. **Start the Agent**

   Run the agent script:

   ```bash
   python src/agent.py
   ```

3. **Join the LiveKit Room**

   Once the agent is running, join the configured LiveKit room to interact with the voice assistant.

## What to Expect

- The Voice Assistant joins the room and greets the user.
- It uses Deepgram for speech-to-text to understand user queries.
- It leverages OpenAI GPT to generate responses.

> **Note**: The LiveKit agent framework handles most of the complexity, so the Deepgram integration is seamless through their plugin system.

## Mock Information

This guide assumes a working LiveKit environment for full functionality. Deepgram integration is tested live with real API keys during execution, ensuring the STT process is verified.

---

For a more detailed walkthrough, refer to `BLOG.md`.
