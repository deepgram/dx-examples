'use strict';

require('dotenv').config();

const express = require('express');
const expressWs = require('express-ws');
const { SignalWire } = require('@signalwire/realtime-api');
const { DeepgramClient } = require('@deepgram/sdk');

const PORT = process.env.PORT || 3000;
const SIGNALWIRE_TOPIC = process.env.SIGNALWIRE_TOPIC || 'home';

// SignalWire sends PCMU (G.711 mu-law) at 8 kHz when using the 'ws' tap
// device with codec 'PCMU'.  This matches Twilio's default telephony encoding.
const DEEPGRAM_LIVE_OPTIONS = {
  model: 'nova-3',
  encoding: 'mulaw',
  sample_rate: 8000,
  channels: 1,
  smart_format: true,
  interim_results: true,
  utterance_end_ms: 1000,
  tag: 'deepgram-examples',
};

function createApp() {
  const app = express();
  expressWs(app);

  if (!process.env.DEEPGRAM_API_KEY) {
    console.error('Error: DEEPGRAM_API_KEY environment variable is not set.');
    console.error('Copy .env.example to .env and add your API key.');
    process.exit(1);
  }

  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  // SignalWire's tapAudio() tells SignalWire to open a WebSocket TO our
  // server and stream raw audio frames.  Each binary message is a chunk
  // of PCMU audio that we forward directly to Deepgram.
  app.ws('/tap', (swWs) => {
    let dgConnection = null;
    let dgReady = false;
    const mediaQueue = [];

    console.log('[tap] SignalWire audio WebSocket connected');

    swWs.on('message', (raw) => {
      // SignalWire sends raw binary audio frames over the WebSocket.
      if (Buffer.isBuffer(raw) && raw.length > 0) {
        if (dgReady && dgConnection) {
          try {
            dgConnection.sendMedia(raw);
          } catch {}
        } else {
          mediaQueue.push(raw);
        }
      }
    });

    swWs.on('close', () => {
      console.log('[tap] SignalWire audio WebSocket closed');
      if (dgConnection) {
        try { dgConnection.sendCloseStream({ type: 'CloseStream' }); } catch {}
        try { dgConnection.close(); } catch {}
        dgConnection = null;
      }
    });

    swWs.on('error', (err) => {
      console.error('[tap] SignalWire WebSocket error:', err.message);
      if (dgConnection) {
        try { dgConnection.close(); } catch {}
        dgConnection = null;
      }
    });

    (async () => {
      dgConnection = await deepgram.listen.v1.connect(DEEPGRAM_LIVE_OPTIONS);

      dgConnection.on('open', () => {
        console.log('[deepgram] Connection opened');
        dgReady = true;
        for (const buf of mediaQueue) {
          try { dgConnection.sendMedia(buf); } catch {}
        }
        mediaQueue.length = 0;
      });

      dgConnection.on('error', (err) => {
        console.error('[deepgram] Error:', err.message);
        dgReady = false;
      });

      dgConnection.on('close', () => {
        console.log('[deepgram] Connection closed');
        dgReady = false;
      });

      dgConnection.on('message', (data) => {
        const transcript = data?.channel?.alternatives?.[0]?.transcript;
        if (transcript) {
          const tag = data.is_final ? 'final' : 'interim';
          console.log(`[${tag}] ${transcript}`);
        }
      });

      dgConnection.connect();
      await dgConnection.waitForOpen();
    })().catch((err) => {
      console.error('[deepgram] Setup failed:', err.message);
    });
  });

  app.get('/', (_req, res) => {
    res.json({ status: 'ok', service: 'deepgram-signalwire-realtime-transcription' });
  });

  return app;
}

// The SignalWire Realtime client connects to SignalWire's servers over a
// persistent RELAY WebSocket — no inbound HTTP webhooks are needed.
// When a call arrives on a topic we're subscribed to, the SDK fires the
// onCallReceived callback.  We answer the call, play a greeting, then
// tap the audio to our Express WebSocket endpoint.
async function startSignalWireClient(tapUrl) {
  if (!process.env.SIGNALWIRE_PROJECT_ID || !process.env.SIGNALWIRE_API_TOKEN) {
    console.error('Error: SIGNALWIRE_PROJECT_ID and SIGNALWIRE_API_TOKEN must be set.');
    process.exit(1);
  }

  const client = await SignalWire({
    project: process.env.SIGNALWIRE_PROJECT_ID,
    token: process.env.SIGNALWIRE_API_TOKEN,
  });

  await client.voice.listen({
    topics: [SIGNALWIRE_TOPIC],
    onCallReceived: async (call) => {
      console.log(`[signalwire] Inbound call from ${call.from} to ${call.to}`);

      try {
        await call.answer();
        console.log('[signalwire] Call answered');

        await call.playTTS({
          text: 'This call is being transcribed by Deepgram.',
        });

        // tapAudio tells SignalWire to open a WebSocket to our server
        // and stream the call audio in PCMU 8 kHz format.
        const tap = await call.tapAudio({
          direction: 'both',
          device: {
            type: 'ws',
            uri: tapUrl,
            codec: 'PCMU',
          },
        });

        console.log(`[signalwire] Tap started — id: ${tap.id}`);

        // Keep the tap running until the caller hangs up.
        await call.waitFor('ended');
        console.log('[signalwire] Call ended');
      } catch (err) {
        console.error('[signalwire] Call handling error:', err.message);
      }
    },
  });

  console.log(`[signalwire] Listening for calls on topic "${SIGNALWIRE_TOPIC}"`);
  return client;
}

if (require.main === module) {
  const app = createApp();
  const server = app.listen(PORT, async () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`  WS   /tap  — SignalWire audio tap WebSocket`);
    console.log(`  GET  /     — Health check`);

    // In production, use a publicly-reachable wss:// URL (e.g. via ngrok).
    // For local development, SignalWire must be able to reach this endpoint.
    const tapUrl = process.env.TAP_URL || `ws://localhost:${PORT}/tap`;
    await startSignalWireClient(tapUrl);
  });
}

module.exports = { createApp, startSignalWireClient };
