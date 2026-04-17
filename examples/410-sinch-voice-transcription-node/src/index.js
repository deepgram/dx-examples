'use strict';

require('dotenv').config();

const express = require('express');
const expressWs = require('express-ws');
const { DeepgramClient } = require('@deepgram/sdk');
const { SinchClient } = require('@sinch/sdk-core');

const PORT = process.env.PORT || 3000;

// Sinch streams 16-bit linear PCM at 8 kHz by default over its
// ConnectStream WebSocket.  Setting sampleRate in streamingOptions
// lets you request 16 kHz instead — higher quality means better
// accuracy for names, numbers, and low-energy consonants.
const SINCH_SAMPLE_RATE = 16000;

const DEEPGRAM_LIVE_OPTIONS = {
  model: 'nova-3',
  encoding: 'linear16',
  sample_rate: SINCH_SAMPLE_RATE,
  channels: 1,
  smart_format: true,
  // interim_results gives fast partial transcripts while the speaker
  // is still talking.  Set to false if you only need final results.
  interim_results: true,
  // utterance_end_ms fires an UtteranceEnd event after this much silence.
  // 1000 ms is a good default for phone conversations.
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

  if (!process.env.SINCH_APPLICATION_KEY || !process.env.SINCH_APPLICATION_SECRET) {
    console.error('Error: SINCH_APPLICATION_KEY and SINCH_APPLICATION_SECRET must be set.');
    console.error('Copy .env.example to .env and add your Sinch credentials.');
    process.exit(1);
  }

  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  // The SinchClient is used here to validate webhook signatures.
  // Sinch signs every callback with HMAC so you can verify the request
  // genuinely came from Sinch and wasn't spoofed.
  const sinch = new SinchClient({
    applicationKey: process.env.SINCH_APPLICATION_KEY,
    applicationSecret: process.env.SINCH_APPLICATION_SECRET,
  });

  // ICE (Incoming Call Event) — Sinch hits this when a call arrives.
  // We respond with SVAML containing a "say" instruction (greeting)
  // followed by a "connectStream" action that tells Sinch to open a
  // WebSocket to our /stream endpoint and pipe the call audio through it.
  //
  // This is Sinch's equivalent of Twilio's TwiML <Connect><Stream> or
  // Vonage's NCCO "connect" with type "websocket".
  app.post('/sinch/ice', (req, res) => {
    const host = req.headers.host;
    const protocol = req.headers['x-forwarded-proto'] === 'https' ? 'wss' : 'ws';
    const streamUrl = `${protocol}://${host}/stream`;

    const callId = req.body?.callid || 'unknown';
    console.log(`[ice] Incoming call ${callId} → streaming to ${streamUrl}`);

    // SVAML response: answer the call, play a greeting, then connect
    // the audio stream to our WebSocket server for Deepgram transcription.
    const svaml = {
      instructions: [
        { name: 'answer' },
        {
          name: 'say',
          text: 'This call is being transcribed by Deepgram.',
          locale: 'en-US',
        },
      ],
      action: {
        name: 'connectStream',
        destination: {
          type: 'websocket',
          endpoint: streamUrl,
        },
        // streamingOptions.sampleRate controls the audio quality Sinch
        // sends.  16000 Hz gives wideband audio — noticeably better than
        // the default 8000 Hz telephony-grade stream.
        streamingOptions: {
          version: 1,
          sampleRate: SINCH_SAMPLE_RATE,
        },
        maxDuration: 3600,
        callHeaders: [
          { key: 'call-id', value: callId },
        ],
      },
    };

    res.json(svaml);
  });

  // ACE (Answered Call Event) — fired when the callee answers.
  // For a connectStream flow there's nothing special to do here;
  // just acknowledge with a continue action to keep the call alive.
  app.post('/sinch/ace', (req, res) => {
    const callId = req.body?.callid || 'unknown';
    console.log(`[ace] Call answered: ${callId}`);
    res.json({ action: { name: 'continue' } });
  });

  // DiCE (Disconnect Call Event) — fired when the call ends.
  // No SVAML response needed; just log and acknowledge.
  app.post('/sinch/dice', (req, res) => {
    const callId = req.body?.callid || 'unknown';
    const reason = req.body?.reason || 'unknown';
    console.log(`[dice] Call disconnected: ${callId} (${reason})`);
    res.sendStatus(200);
  });

  // Each phone call opens a separate WebSocket here.  Sinch sends an
  // initial JSON text message with call metadata and custom headers,
  // followed by binary frames containing raw linear16 PCM audio.
  // This is similar to Vonage's WebSocket format — raw binary, no
  // base64 wrapping like Twilio.
  app.ws('/stream', (sinchWs, req) => {
    let dgConnection = null;
    let dgReady = false;
    let callId = 'unknown';
    const mediaQueue = [];

    console.log('[stream] Sinch WebSocket connected');

    sinchWs.on('message', (raw) => {
      // Sinch sends two types of messages over the ConnectStream WebSocket:
      //   1. An initial JSON text message with metadata (call headers,
      //      content-type, custom headers from the SVAML response).
      //   2. Binary messages containing raw PCM audio frames.
      if (typeof raw === 'string') {
        try {
          const metadata = JSON.parse(raw);
          if (metadata?.callHeaders) {
            const header = metadata.callHeaders.find(h => h.key === 'call-id');
            if (header) callId = header.value;
          }
          console.log(`[sinch] Stream metadata — call: ${callId}`);
        } catch {
          console.warn('[sinch] Unexpected text message:', raw.substring(0, 100));
        }
        return;
      }

      // Binary frame — raw linear16 PCM audio.  Forward directly to Deepgram.
      if (dgReady && dgConnection) {
        try { dgConnection.sendMedia(raw); } catch {}
      } else if (raw.length > 0) {
        mediaQueue.push(raw);
      }
    });

    sinchWs.on('close', () => {
      console.log(`[stream] Sinch WebSocket closed (call: ${callId})`);
      if (dgConnection) {
        try { dgConnection.sendCloseStream({ type: 'CloseStream' }); } catch {}
        try { dgConnection.close(); } catch {}
        dgConnection = null;
      }
    });

    sinchWs.on('error', (err) => {
      console.error('[stream] Sinch WebSocket error:', err.message);
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

      // Deepgram sends transcript events here.  is_final distinguishes
      // partial (interim) results from stable ones.  In production you'd
      // forward these to a UI, database, or analytics pipeline.
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
    res.json({ status: 'ok', service: 'deepgram-sinch-voice-transcription' });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
    console.log(`  POST /sinch/ice   — Sinch ICE webhook (returns SVAML)`);
    console.log(`  POST /sinch/ace   — Sinch ACE webhook`);
    console.log(`  POST /sinch/dice  — Sinch DiCE webhook`);
    console.log(`  WS   /stream      — Sinch audio WebSocket`);
    console.log(`  GET  /            — Health check`);
  });
}

module.exports = { createApp };
