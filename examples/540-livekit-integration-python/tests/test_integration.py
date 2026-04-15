import subprocess
import os

# Define environment variables for the test
os.environ['DEEPGRAM_API_KEY'] = 'your_deepgram_api_key'
os.environ['LIVEKIT_WS_URL'] = 'ws://localhost:7880'

# Function to run the Python script and check the output
def test_transcription():
    try:
        # Run the main script
        result = subprocess.run(
            ['python3', 'src/main.py'],
            capture_output=True,
            text=True,
            check=True
        )

        # Check for expected outputs
        assert "Transcript received:" in result.stdout
        print("Integration test passed.")

    except subprocess.CalledProcessError as e:
        print("Error running the script:", e)
        exit(1)
    except AssertionError:
        print("Test failed: Output did not match expected output.")
        exit(1)

test_transcription()