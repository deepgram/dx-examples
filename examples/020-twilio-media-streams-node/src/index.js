'use strict';

require('dotenv').config();

const express = require('express');
const expressWs = require('express-ws');
const { DeepgramClient } = require('@deepgram/sdk');
const twilio = require('twilio');

const PORT = process.env.PORT || 3000;

// Twilio sends μ-law 8 kHz mono audio via Media Streams.  Deepgram can ingest
// mulaw natively — no transcoding step needed.  We just tell Deepgram the
// encoding up front so it skips the usual content-type detection.
const DEEPGRAM_LIVE_OPTIONS = {
  model: 'nova-3-phonecall',
  encoding: 'mulaw',
  sample_rate: 8000,
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

  if (!process.env.DEEPGRAM_API_KEY) {
    console.error('Error: DEEPGRAM_API_KEY environment variable is not set.');
    console.error('Copy .env.example to .env and add your API key.');
    process.exit(1);
  }

  // SDK v5: DeepgramClient replaces the old createClient() from v3/v4.
  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  // Twilio hits this endpoint when a call comes in.  The TwiML response tells
  // Twilio to open a bidirectional Media Stream back to our /media WebSocket.
  // <Connect><Stream> blocks further TwiML until the WebSocket closes, which
  // keeps the call alive for as long as we need.
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

  // Each phone call opens a separate WebSocket here.  Twilio sends JSON
  // messages with event types: connected, start, media, stop.
  app.ws('/media', (twilioWs) => {
    let dgConnection = null;
    let streamSid = null;

    console.log('[media] Twilio WebSocket connected');

    // Open a parallel WebSocket to Deepgram for this call.
    // SDK v5: listen.v1.live() returns a WebSocket connection instance.
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

    twilioWs.on('message', (raw) => {
      try {
        const message = JSON.parse(raw);

        switch (message.event) {
          case 'connected':
            // First message after WebSocket handshake — protocol version info.
            console.log('[twilio] Stream connected');
            break;

          case 'start':
            // Contains stream metadata: accountSid, callSid, mediaFormat.
            // We store streamSid for logging; you'd use it if sending audio
            // back to Twilio in a bidirectional integration.
            streamSid = message.start.streamSid;
            console.log(`[twilio] Stream started — SID: ${streamSid}`);
            break;

          case 'media':
            // The payload is base64-encoded mulaw audio.  Deepgram's live
            // WebSocket accepts raw binary, so we decode from base64 first.
            if (dgConnection) {
              const audio = Buffer.from(message.media.payload, 'base64');
              dgConnection.send(audio);
            }
            break;

          case 'stop':
            // Call ended or stream was stopped.  Clean up the Deepgram
            // connection so it can return any final buffered transcript.
            console.log('[twilio] Stream stopped');
            if (dgConnection) {
              dgConnection.finish();
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
        dgConnection.finish();
        dgConnection = null;
      }
    });

    twilioWs.on('error', (err) => {
      console.error('[media] Twilio WebSocket error:', err.message);
      if (dgConnection) {
        dgConnection.finish();
        dgConnection = null;
      }
    });
  });

  // Health check — useful for load balancers and uptime monitors.
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
