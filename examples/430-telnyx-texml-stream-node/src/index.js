'use strict';

require('dotenv').config();

const express = require('express');
const expressWs = require('express-ws');
const { DeepgramClient } = require('@deepgram/sdk');

const PORT = process.env.PORT || 3000;

// Telnyx TeXML Stream sends mulaw-encoded audio at 8 kHz — same as telephony standard
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
  app.use(express.urlencoded({ extended: false }));

  if (!process.env.DEEPGRAM_API_KEY) {
    console.error('Error: DEEPGRAM_API_KEY environment variable is not set.');
    console.error('Copy .env.example to .env and add your API key.');
    process.exit(1);
  }

  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  // Telnyx sends POST webhooks when a call arrives; respond with TeXML
  // containing the <Stream> verb to fork audio to our WebSocket endpoint
  app.post('/voice', (req, res) => {
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    const streamUrl = `${protocol}://${host}/stream`;

    // TeXML is Telnyx's XML dialect — <Stream> opens a WS for live audio
    const texml = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      '<Response>',
      '  <Say>This call is being transcribed by Deepgram.</Say>',
      `  <Stream url="${streamUrl}" track="inbound_track" />`,
      '</Response>',
    ].join('\n');

    res.type('text/xml').send(texml);
    console.log(`[voice] New call → streaming to ${streamUrl}`);
  });

  // WebSocket endpoint that receives the Telnyx audio stream.
  // Telnyx sends JSON messages with events: connected, start, media, stop —
  // the same pattern as Twilio Media Streams.
  app.ws('/stream', (telnyxWs) => {
    let dgConnection = null;
    let dgReady = false;
    let streamSid = null;
    const mediaQueue = [];

    console.log('[stream] Telnyx WebSocket connected');

    telnyxWs.on('message', (raw) => {
      try {
        const message = JSON.parse(raw);

        switch (message.event) {
          case 'connected':
            console.log('[telnyx] Stream connected');
            break;

          case 'start':
            streamSid = message.start.streamSid;
            console.log(`[telnyx] Stream started — SID: ${streamSid}`);
            break;

          case 'media':
            // media.payload is base64-encoded mulaw audio
            if (dgReady && dgConnection) {
              try {
                dgConnection.sendMedia(Buffer.from(message.media.payload, 'base64'));
              } catch {}
            } else {
              mediaQueue.push(message.media.payload);
            }
            break;

          case 'stop':
            console.log('[telnyx] Stream stopped');
            if (dgConnection) {
              try { dgConnection.sendCloseStream({ type: 'CloseStream' }); } catch {}
              try { dgConnection.close(); } catch {}
              dgConnection = null;
            }
            break;

          default:
            break;
        }
      } catch (err) {
        console.error('[stream] Error handling message:', err.message);
      }
    });

    telnyxWs.on('close', () => {
      console.log('[stream] Telnyx WebSocket closed');
      if (dgConnection) {
        try { dgConnection.sendCloseStream({ type: 'CloseStream' }); } catch {}
        try { dgConnection.close(); } catch {}
        dgConnection = null;
      }
    });

    telnyxWs.on('error', (err) => {
      console.error('[stream] Telnyx WebSocket error:', err.message);
      if (dgConnection) {
        try { dgConnection.close(); } catch {}
        dgConnection = null;
      }
    });

    // Open Deepgram live connection as soon as Telnyx WS connects
    (async () => {
      dgConnection = await deepgram.listen.v1.connect(DEEPGRAM_LIVE_OPTIONS);

      dgConnection.on('open', () => {
        console.log('[deepgram] Connection opened');
        dgReady = true;
        // Drain anything that arrived before Deepgram was ready
        for (const payload of mediaQueue) {
          try {
            dgConnection.sendMedia(Buffer.from(payload, 'base64'));
          } catch {}
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

      // data.channel.alternatives[0].transcript holds the text
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
    res.json({ status: 'ok', service: 'deepgram-telnyx-texml-stream' });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`  POST /voice   — Telnyx webhook (returns TeXML)`);
    console.log(`  WS   /stream  — Telnyx audio stream WebSocket`);
    console.log(`  GET  /        — Health check`);
  });
}

module.exports = { createApp };
