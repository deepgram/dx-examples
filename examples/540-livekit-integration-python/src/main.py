import asyncio
from deepgram import Deepgram
import websockets

# Environment variables or placeholders for keys
DEEPGRAM_API_KEY = 'your_deepgram_api_key'
LIVEKIT_WS_URL = 'ws://localhost:7880'

# Initialize Deepgram
dg_client = Deepgram(DEEPGRAM_API_KEY)

async def transcribe_audio(uri):
    async with websockets.connect(uri) as websocket:
        # Configuration for Deepgram
        options = { 'punctuate': True, 'language': 'en' }
        try:
            # Connect to Deepgram's realtime transcribe endpoint
            deepgram_socket = await dg_client.transcription.live(options)
            
            async def on_transcript(transcript):
                print("Transcript received:", transcript)
            
            async def on_close():
                print("Connection closed")

            # Set event handlers
            deepgram_socket.on_transcript = on_transcript
            deepgram_socket.on_close = on_close

            async for message in websocket:
                # Send the audio stream to Deepgram
                deepgram_socket.send(message)

        except Exception as e:
            print("Error:", e)

asyncio.run(transcribe_audio(LIVEKIT_WS_URL))