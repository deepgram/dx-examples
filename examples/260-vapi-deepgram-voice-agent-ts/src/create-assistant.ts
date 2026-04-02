import 'dotenv/config';
import { VapiClient } from '@vapi-ai/server-sdk';

// Creates a Vapi assistant configured with Deepgram for both STT and TTS.
// Run once to provision the assistant, then use the returned ID for calls.

if (!process.env.VAPI_API_KEY) {
  console.error('Error: VAPI_API_KEY environment variable is not set.');
  process.exit(1);
}

const vapi = new VapiClient({ token: process.env.VAPI_API_KEY });

// Webhook URL where Vapi sends function-call and status events.
// In development, use a tunnel (ngrok, cloudflared) pointing to your local server.
const SERVER_URL = process.env.VAPI_SERVER_URL || 'https://your-server.example.com/webhook';

async function main() {
  const assistant = await vapi.assistants.create({
    name: 'Deepgram Pizza Assistant',

    // Greeting spoken when a call connects
    firstMessage: 'Thanks for calling Deepgram Pizza! How can I help you today?',

    // ── Deepgram STT (transcriber) ────────────────────────────────────────
    // nova-3 is the latest and most accurate general-purpose model.
    // language defaults to multi (automatic language detection) if omitted.
    transcriber: {
      provider: 'deepgram',
      model: 'nova-3',
      language: 'en',
      smartFormat: true,
      // ← endpointing controls how quickly the agent detects the user stopped talking
      // Lower values = faster response but may clip mid-sentence pauses
      endpointing: 255,
    },

    // ── Deepgram TTS (voice) ──────────────────────────────────────────────
    // aura-2 is the latest Deepgram TTS model family with natural-sounding voices.
    // See https://developers.deepgram.com/docs/tts-models for available voice IDs.
    voice: {
      provider: 'deepgram',
      voiceId: 'thalia',
    },

    // ── LLM (the "brain" that generates responses) ────────────────────────
    model: {
      provider: 'openai',
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'You are a friendly phone assistant for a pizza shop called "Deepgram Pizza". ' +
            'You help customers check their order status. Keep responses concise — the caller is on the phone. ' +
            'When a customer asks about their order, use the check_order_status function to look it up.',
        },
      ],
      // ← THIS enables function calling: the LLM can invoke server-side tools
      tools: [
        {
          type: 'function',
          function: {
            name: 'check_order_status',
            description: 'Look up the current status of a pizza order by order number',
            parameters: {
              type: 'object',
              properties: {
                order_number: {
                  type: 'string',
                  description: 'The order number to look up, e.g. "1001"',
                },
              },
              required: ['order_number'],
            },
          },
        },
      ],
    },

    // ── Server (webhook) configuration ────────────────────────────────────
    server: {
      url: SERVER_URL,
    },
    serverMessages: [
      'function-call',
      'status-update',
      'end-of-call-report',
      'conversation-update',
    ],

    maxDurationSeconds: 600,
  });

  console.log('Assistant created successfully!');
  console.log(`  ID:   ${assistant.id}`);
  console.log(`  Name: ${assistant.name}`);
  console.log(`  STT:  Deepgram nova-3`);
  console.log(`  TTS:  Deepgram thalia (aura-2)`);
  console.log('');
  console.log('Next steps:');
  console.log(`  1. Set VAPI_ASSISTANT_ID=${assistant.id} in your .env`);
  console.log('  2. Start the webhook server: npm run dev');
  console.log('  3. Expose your server (ngrok/cloudflared) and update VAPI_SERVER_URL');
  console.log('  4. Make a test call from the Vapi dashboard or POST /call');
}

main().catch((err) => {
  console.error('Error creating assistant:', err.message || err);
  process.exit(1);
});
