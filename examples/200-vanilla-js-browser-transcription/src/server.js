'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const expressWs = require('express-ws');
const { DeepgramClient } = require('@deepgram/sdk');

const PORT = process.env.PORT || 3000;

// nova-3 with smart_format gives punctuation, capitalisation, and number
// formatting at negligible latency cost. interim_results makes the UI feel
// responsive — partial text appears while the speaker is still talking.
const DEEPGRAM_LIVE_OPTIONS = {
  model: 'nova-3',
  encoding: 'linear16',   // ← browser MediaRecorder/AudioWorklet sends raw PCM
  sample_rate: 16000,
  channels: 1,
  smart_format: true,
  interim_results: true,
  utterance_end_ms: 1500,
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

  // Serve the single-file HTML frontend — no bundler needed
  app.use(express.static(path.join(__dirname)));

  // Browser connects here via WebSocket to stream microphone audio.
  // The server proxies each audio chunk to Deepgram and relays transcripts
  // back — this keeps the API key server-side.
  app.ws('/listen', (browserWs) => {
    let dgConnection = null;
    let dgReady = false;
    const mediaQueue = [];

    console.log('[ws] Browser connected');

    browserWs.on('message', (data) => {
      if (typeof data === 'string') return; // ignore text frames

      if (dgReady && dgConnection) {
        try {
          dgConnection.sendBinary(data);
        } catch {}
      } else {
        mediaQueue.push(data);
      }
    });

    browserWs.on('close', () => {
      console.log('[ws] Browser disconnected');
      if (dgConnection) {
        try { dgConnection.sendCloseStream({ type: 'CloseStream' }); } catch {}
        try { dgConnection.close(); } catch {}
        dgConnection = null;
      }
    });

    browserWs.on('error', (err) => {
      console.error('[ws] Browser error:', err.message);
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
        for (const chunk of mediaQueue) {
          try { dgConnection.sendBinary(chunk); } catch {}
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
        dgConnection = null;
      });

      dgConnection.on('message', (data) => {
        // Relay every Deepgram message (interim + final) to the browser
        if (browserWs.readyState === browserWs.OPEN) {
          browserWs.send(JSON.stringify(data));
        }

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
      if (browserWs.readyState === browserWs.OPEN) {
        browserWs.send(JSON.stringify({ error: 'Deepgram connection failed' }));
        browserWs.close();
      }
    });
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'vanilla-js-browser-transcription' });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log(`  Open http://localhost:${PORT}/index.html in your browser`);
    console.log(`  WS  /listen  — microphone audio proxy to Deepgram`);
    console.log(`  GET /health  — health check`);
  });
}

module.exports = { createApp };
