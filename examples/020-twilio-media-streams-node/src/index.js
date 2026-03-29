'use strict';

require('dotenv').config();

const express = require('express');
const expressWs = require('express-ws');
const { DeepgramClient } = require('@deepgram/sdk');
const twilio = require('twilio');

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

  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

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

  app.ws('/media', async (twilioWs) => {
    let dgConnection = null;
    let streamSid = null;

    console.log('[media] Twilio WebSocket connected');

    const socket = await deepgram.listen.v1.connect({
      ...DEEPGRAM_LIVE_OPTIONS,
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
    });
    dgConnection = socket;

    dgConnection.on('open', () => {
      console.log('[deepgram] Connection opened');
    });

    dgConnection.on('error', (err) => {
      console.error('[deepgram] Error:', err.message);
    });

    dgConnection.on('close', () => {
      console.log('[deepgram] Connection closed');
    });

    dgConnection.on('message', (msg) => {
      try {
        const data = typeof msg === 'string' ? JSON.parse(msg) : msg;
        const transcript = data?.channel?.alternatives?.[0]?.transcript;
        if (transcript) {
          const tag = data.is_final ? 'final' : 'interim';
          console.log(`[${tag}] ${transcript}`);
        }
      } catch {
      }
    });

    dgConnection.connect();

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
            if (dgConnection) {
              const audio = Buffer.from(message.media.payload, 'base64');
              dgConnection.sendMedia(audio);
            }
            break;

          case 'stop':
            console.log('[twilio] Stream stopped');
            if (dgConnection) {
              dgConnection.sendCloseStream({ type: 'CloseStream' });
              dgConnection.close();
              dgConnection = null;
            }
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
        dgConnection.sendCloseStream({ type: 'CloseStream' });
        dgConnection.close();
        dgConnection = null;
      }
    });

    twilioWs.on('error', (err) => {
      console.error('[media] Twilio WebSocket error:', err.message);
      if (dgConnection) {
        dgConnection.close();
        dgConnection = null;
      }
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
