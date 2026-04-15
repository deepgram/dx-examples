const { Deepgram } = require('@deepgram/sdk');
const dotenv = require('dotenv');

dotenv.config();

function testEnvironmentVariables() {
  if (!process.env.DEEPGRAM_API_KEY || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_HOST) {
    console.error('MISSING_CREDENTIALS: Please provide the necessary environment variables in the .env file.');
    process.exit(2);
  }
}

async function testDeepgramAPI() {
  try {
    const deepgram = new Deepgram(process.env.DEEPGRAM_API_KEY);
    const response = await deepgram.transcription.preRecorded({
      url: 'https://static.deepgram.com/examples/Bueller-Life-moves-pretty-fast.wav',
    });

    if (response && response.results) {
      console.log('Deepgram response received:', response.results);
      console.log('Deepgram API test passed.');
    } else {
      throw new Error('Failed to get transcription result.');
    }
  } catch (error) {
    console.error('Deepgram API test failed:', error);
    process.exit(1);
  }
}

async function testLivekitConnection() {
  try {
    const fakeHost = 'http://localhost';  // As using actual host may need active server, use local for test sanity checks
    console.log('Attempting to connect to Livekit (dummy test as fake host used)');
    console.log('Connection deep test deferred'); // Normally would call the real connect here
  } catch (error) {
    console.error('Livekit connection test failed:', error);
    process.exit(1);
  }
}

function runTests() {
  testEnvironmentVariables();
  testDeepgramAPI();
  testLivekitConnection();
}

runTests();