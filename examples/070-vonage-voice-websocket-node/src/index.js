'use strict';

require('dotenv').config();

const express = require('express');
const expressWs = require('express-ws');
const { DeepgramClient } = require('@deepgram/sdk');

const PORT = process.env.PORT || 3000;

// Vonage sends linear16 (signed 16-bit PCM) audio at 16 kHz mono over
// its WebSocket connection — a higher quality stream than Twilio's 8 kHz μ-law.
// This means better transcription accuracy out of the box, especially for
// names, numbers, and low-energy consonants that get lost at 8 kHz.
const DEEPGRAM_LIVE_OPTIONS = {
  model: 'nova-3-phonecall',
  encoding: 'linear16',
  sample_rate: 16000,
  channels: 1,
  smart_format: true,
  // interim_results gives fast, partial transcripts while the speaker is still
  // talking.  Set to false if you only want final, stable results.
  interim_results: true,
  // utterance_end_ms fires an UtteranceEnd event when Deepgram detects silence.
  // 1000 ms is a good default for phone conversations — short enough to feel
  // real-time, long enough to avoid splitting mid-sentence pauses.
  utterance_end_ms: 1000,
};

function createApp() {
  const app = express();
  expressWs(app);
  app.use(express.json());

  if (!process.env.DEEPGRAM_API_KEY) {
    console.error('Error: DEEPGRAM_API_KEY environment variable is not set.');
    console.error('Copy .env.example to .env and add your API key.');
    process.exit(1);
  }

  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  // Vonage hits this endpoint when a call comes in (the "answer URL").
  // We return an NCCO (Nexmo Call Control Object) — Vonage's equivalent of
  // Twilio's TwiML.  The "connect" action with type "websocket" tells Vonage
  // to open a WebSocket to our /socket endpoint and stream the call audio.
  //
  // Key difference from Twilio: Vonage sends raw binary PCM frames directly
  // over the WebSocket — no base64 encoding, no JSON wrapping.  This is more
  // efficient and simpler to forward to Deepgram.
  app.get('/webhooks/answer', (req, res) => {
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    const socketUrl = `${protocol}://${host}/socket`;

    // NCCO is a JSON array of actions.  "talk" plays a greeting, then
    // "connect" opens the WebSocket.  The WebSocket stays open for the
    // duration of the call — Vonage closes it when the caller hangs up.
    const ncco = [
      {
        action: 'talk',
        text: 'This call is being transcribed by Deepgram.',
      },
      {
        action: 'connect',
        endpoint: [
          {
            type: 'websocket',
            uri: socketUrl,
            // content-type tells Vonage what audio format to stream.
            // audio/l16;rate=16000 is 16-bit linear PCM at 16 kHz — the
            // highest quality Vonage offers over WebSocket and a great
            // match for Deepgram's nova-3-phonecall model.
            'content-type': 'audio/l16;rate=16000',
            headers: {
              // You can pass custom headers to identify the call on the
              // WebSocket side.  The conversation UUID is useful for
              // correlating transcripts with Vonage call records.
              'conversation-uuid': req.query.conversation_uuid || 'unknown',
            },
          },
        ],
      },
    ];

    res.json(ncco);
    console.log(`[answer] New call → streaming to ${socketUrl}`);
  });

  // Vonage sends call status events here — answered, completed, failed, etc.
  // Required by Vonage even if you don't use it; a 200 response is enough.
  app.post('/webhooks/event', (req, res) => {
    const { status, conversation_uuid } = req.body || {};
    if (status) {
      console.log(`[event] ${conversation_uuid || 'unknown'}: ${status}`);
    }
    res.sendStatus(200);
  });

  // Each phone call opens a separate WebSocket here.  Unlike Twilio (which
  // wraps audio in JSON messages), Vonage sends raw binary PCM frames — each
  // message is a Buffer of signed 16-bit little-endian samples.  This means
  // we can forward directly to Deepgram with zero parsing or decoding.
  app.ws('/socket', (vonageWs, req) => {
    let dgConnection = null;
    let conversationUuid = 'unknown';

    console.log('[socket] Vonage WebSocket connected');

    dgConnection = deepgram.listen.v1.live(DEEPGRAM_LIVE_OPTIONS);

    dgConnection.on('open', () => {
      console.log('[deepgram] Connection opened');
    });

    dgConnection.on('error', (err) => {
      console.error('[deepgram] Error:', err.message);
    });

    dgConnection.on('close', () => {
      console.log('[deepgram] Connection closed');
    });

    // Deepgram sends transcript events here.  The is_final flag distinguishes
    // partial (interim) results from stable ones.  In production you'd forward
    // these to a UI, database, or analytics pipeline.
    dgConnection.on('message', (msg) => {
      try {
        const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
        const transcript = data?.channel?.alternatives?.[0]?.transcript;
        if (transcript) {
          const tag = data.is_final ? 'final' : 'interim';
          console.log(`[${tag}] ${transcript}`);
        }
      } catch {
        // Non-transcript control messages (Metadata, UtteranceEnd) — safe to ignore here.
      }
    });

    vonageWs.on('message', (raw) => {
      // Vonage sends two types of messages:
      //   1. A JSON text message at connection start with metadata (content-type,
      //      custom headers we passed in the NCCO).
      //   2. Binary messages containing raw PCM audio frames.
      //
      // We detect JSON by checking if the message is a string (text frame)
      // vs a Buffer (binary frame).
      if (typeof raw === 'string') {
        try {
          const metadata = JSON.parse(raw);
          conversationUuid = metadata?.headers?.['conversation-uuid'] || conversationUuid;
          console.log(`[vonage] Stream metadata — conversation: ${conversationUuid}`);
          console.log(`[vonage] Audio format: ${metadata['content-type'] || 'unknown'}`);
        } catch {
          // Unexpected text frame — log and continue.
          console.warn('[vonage] Unexpected text message:', raw.substring(0, 100));
        }
        return;
      }

      // Binary frame — raw linear16 PCM audio.  Forward directly to Deepgram.
      // No base64 decoding or JSON parsing needed — this is the main advantage
      // of Vonage's WebSocket format over Twilio's Media Streams.
      if (dgConnection && raw.length > 0) {
        dgConnection.send(raw);
      }
    });

    vonageWs.on('close', () => {
      console.log(`[socket] Vonage WebSocket closed (conversation: ${conversationUuid})`);
      if (dgConnection) {
        dgConnection.finish();
        dgConnection = null;
      }
    });

    vonageWs.on('error', (err) => {
      console.error('[socket] Vonage WebSocket error:', err.message);
      if (dgConnection) {
        dgConnection.finish();
        dgConnection = null;
      }
    });
  });

  // Health check — useful for load balancers and uptime monitors.
  app.get('/', (_req, res) => {
    res.json({ status: 'ok', service: 'deepgram-vonage-voice-websocket' });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`  GET  /webhooks/answer — Vonage answer webhook (returns NCCO)`);
    console.log(`  POST /webhooks/event  — Vonage event webhook`);
    console.log(`  WS   /socket          — Vonage audio WebSocket`);
    console.log(`  GET  /                — Health check`);
  });
}

module.exports = { createApp };
