'use strict';

require('dotenv').config();

const express = require('express');
const expressWs = require('express-ws');
const { DeepgramClient } = require('@deepgram/sdk');
const { Bxml: BxmlNs } = require('bandwidth-sdk');
const { Bxml, SpeakSentence, StartStream, StopStream, Pause } = BxmlNs;

const PORT = process.env.PORT || 3000;

// Bandwidth streams μ-law (PCMU) audio at 8 kHz mono — the standard telephony
// encoding.  This matches Twilio's format but differs from Vonage (linear16 16 kHz).
// nova-3 handles both encodings natively; mulaw is specified here to match
// what Bandwidth actually sends on the wire.
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
  app.use(express.json());

  if (!process.env.DEEPGRAM_API_KEY) {
    console.error('Error: DEEPGRAM_API_KEY environment variable is not set.');
    console.error('Copy .env.example to .env and add your API key.');
    process.exit(1);
  }

  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  // Bandwidth calls this endpoint when an inbound call arrives (the "answer URL").
  // We return BXML — Bandwidth's XML call-control language — that plays a greeting
  // then opens a WebSocket media stream back to our /stream endpoint.
  //
  // Key difference from Twilio: Bandwidth uses <StartStream> (not <Connect><Stream>)
  // and sends JSON-wrapped base64 audio with an eventType field rather than an event field.
  app.post('/webhooks/answer', (req, res) => {
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    const streamUrl = `${protocol}://${host}/stream`;

    const speak = new SpeakSentence('This call is being transcribed by Deepgram.');
    const startStream = new StartStream({
      destination: streamUrl,
      name: 'deepgram_stream',
    });
    // StopStream with wait keeps the call alive until the stream ends.
    // Pause holds the BXML execution so the call doesn't hang up immediately.
    const pause = new Pause({ duration: 3600 });
    const stopStream = new StopStream({ name: 'deepgram_stream' });
    const bxml = new Bxml([speak, startStream, pause, stopStream]);

    res.type('application/xml').send(bxml.toBxml());
    console.log(`[answer] New call → streaming to ${streamUrl}`);
  });

  // Bandwidth sends call lifecycle events here (initiated, ringing, answered, completed).
  // A 200 response is required even if you don't use the data.
  app.post('/webhooks/status', (req, res) => {
    const { eventType, callId } = req.body || {};
    if (eventType) {
      console.log(`[status] ${callId || 'unknown'}: ${eventType}`);
    }
    res.sendStatus(200);
  });

  // Bandwidth opens a WebSocket here for each active <StartStream>.
  // Messages are JSON with an eventType field:
  //   "start"  — stream metadata (accountId, callId, tracks with encoding/sampleRate)
  //   "media"  — base64-encoded audio in the "payload" field
  //   "stop"   — stream ended (caller hung up or StopStream executed)
  //
  // Unlike Vonage (raw binary PCM), Bandwidth wraps audio in JSON — similar to
  // Twilio but with different field names (eventType vs event, payload vs media.payload).
  app.ws('/stream', (bandwidthWs) => {
    let dgConnection = null;
    let dgReady = false;
    let callId = 'unknown';
    const mediaQueue = [];

    console.log('[stream] Bandwidth WebSocket connected');

    bandwidthWs.on('message', (raw) => {
      try {
        const message = JSON.parse(raw);

        switch (message.eventType) {
          case 'start':
            callId = message.metadata?.callId || callId;
            console.log(`[bandwidth] Stream started — call: ${callId}`);
            if (message.metadata?.tracks) {
              const track = message.metadata.tracks[0];
              console.log(`[bandwidth] Audio format: ${track?.mediaFormat?.encoding} @ ${track?.mediaFormat?.sampleRate} Hz`);
            }
            break;

          case 'media':
            if (dgReady && dgConnection) {
              try {
                dgConnection.sendMedia(Buffer.from(message.payload, 'base64'));
              } catch {}
            } else {
              mediaQueue.push(message.payload);
            }
            break;

          case 'stop':
            console.log(`[bandwidth] Stream stopped — call: ${callId}`);
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

    bandwidthWs.on('close', () => {
      console.log(`[stream] Bandwidth WebSocket closed — call: ${callId}`);
      if (dgConnection) {
        try { dgConnection.sendCloseStream({ type: 'CloseStream' }); } catch {}
        try { dgConnection.close(); } catch {}
        dgConnection = null;
      }
    });

    bandwidthWs.on('error', (err) => {
      console.error('[stream] Bandwidth WebSocket error:', err.message);
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

      // Deepgram transcript events arrive here.
      // data.channel.alternatives[0].transcript contains the text.
      // data.is_final distinguishes stable results from interim partials.
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
    res.json({ status: 'ok', service: 'deepgram-bandwidth-call-transcription' });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`  POST /webhooks/answer  — Bandwidth answer webhook (returns BXML)`);
    console.log(`  POST /webhooks/status  — Bandwidth status webhook`);
    console.log(`  WS   /stream           — Bandwidth media stream WebSocket`);
    console.log(`  GET  /                 — Health check`);
  });
}

module.exports = { createApp };
