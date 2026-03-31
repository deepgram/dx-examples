'use strict';

require('dotenv').config();

const express = require('express');
const expressWs = require('express-ws');
const { DeepgramClient } = require('@deepgram/sdk');

const PORT = process.env.PORT || 3000;

const DEEPGRAM_LIVE_OPTIONS = {
  model: 'nova-3',
  encoding: 'mulaw',
  sample_rate: 8000,
  channels: 1,
  smart_format: true,
  interim_results: true,
  utterance_end_ms: 1000,
};

function createApp() {
  const app = express();
  expressWs(app);

  if (!process.env.DEEPGRAM_API_KEY) {
    console.error('Error: DEEPGRAM_API_KEY environment variable is not set.');
    console.error('Copy .env.example to .env and add your API key.');
    process.exit(1);
  }

  const deepgram = new DeepgramClient({
    apiKey: process.env.DEEPGRAM_API_KEY,
  });

  app.post('/voice', (req, res) => {
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    const streamUrl = `${protocol}://${host}/media`;

    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say>This call is being transcribed by Deepgram.</Say>
  <Connect>
    <Stream url="${streamUrl}" />
  </Connect>
</Response>`;

    res.type('text/xml').send(twiml);
    console.log(`[voice] New call → streaming to ${streamUrl}`);
  });

  app.ws('/media', (twilioWs) => {
    let dgConnection = null;
    let dgReady = false;
    let streamSid = null;
    const mediaQueue = [];

    console.log('[media] Twilio WebSocket connected');

    twilioWs.on('message', (raw) => {
      try {
        const message = JSON.parse(raw);

        switch (message.event) {
          case 'connected':
            console.log('[twilio] Stream connected');
            break;

          case 'start':
            streamSid = message.start.streamSid;
            console.log(`[twilio] Stream started — SID: ${streamSid}`);
            break;

          case 'media':
            if (dgReady && dgConnection) {
              try {
                dgConnection.sendMedia(Buffer.from(message.media.payload, 'base64'));
              } catch {}
            } else {
              mediaQueue.push(message.media.payload);
            }
            break;

          case 'stop':
            console.log('[twilio] Stream stopped');
            if (dgConnection) {
              try { dgConnection.sendCloseStream({ type: 'CloseStream' }); } catch {}
              try { dgConnection.close(); } catch {}
              dgConnection = null;
            }
            twilioWs.close();
            break;

          default:
            break;
        }
      } catch (err) {
        console.error('[media] Error handling message:', err.message);
      }
    });

    twilioWs.on('close', () => {
      console.log('[media] Twilio WebSocket closed');
      if (dgConnection) {
        try { dgConnection.sendCloseStream({ type: 'CloseStream' }); } catch {}
        try { dgConnection.close(); } catch {}
        dgConnection = null;
      }
    });

    twilioWs.on('error', (err) => {
      console.error('[media] Twilio WebSocket error:', err.message);
      if (dgConnection) {
        try { dgConnection.close(); } catch {}
        dgConnection = null;
      }
    });

    (async () => {
      dgConnection = await deepgram.listen.v1.connect(DEEPGRAM_LIVE_OPTIONS);

      dgConnection.on('open', () => {
        console.log('[deepgram] Connection opened');
      });

      dgConnection.on('error', (err) => {
        console.error('[deepgram] Error:', err.message);
      });

      dgConnection.on('close', () => {
        console.log('[deepgram] Connection closed');
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

      dgReady = true;
      for (const payload of mediaQueue) {
        try {
          dgConnection.sendMedia(Buffer.from(payload, 'base64'));
        } catch {}
      }
      mediaQueue.length = 0;
    })().catch((err) => {
      console.error('[deepgram] Setup failed:', err.message);
    });
  });

  app.get('/', (_req, res) => {
    res.json({ status: 'ok', service: 'deepgram-twilio-media-streams' });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`  POST /voice  — Twilio webhook (returns TwiML)`);
    console.log(`  WS   /media  — Twilio Media Stream WebSocket`);
    console.log(`  GET  /       — Health check`);
  });
}

module.exports = { createApp };
