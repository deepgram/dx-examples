# Livekit and Deepgram Integration Example (Node.js)

This example demonstrates how to integrate Livekit with Deepgram for real-time audio transcription using Node.js.

## Prerequisites

- Node.js and npm installed
- Deepgram API Key
- Livekit cloud account or local server setup

## Environment Variables

- `DEEPGRAM_API_KEY`: Your Deepgram API key
- `LIVEKIT_API_KEY`: Your Livekit API key (if using Livekit cloud)
- `LIVEKIT_HOST`: Host URL for Livekit server

## Running the Example

1. Clone the repository and navigate to this example's directory.
2. Install the dependencies with `npm install`.
3. Set up the `.env` file using `.env.example` as a template.
4. Run the example using `node src/index.js`.

## What to Expect

Once the application is running, it will connect to a Livekit room and start transcribing any audio input in real-time using Deepgram. The transcriptions will be printed in the console.