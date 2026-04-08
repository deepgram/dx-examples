'use strict';

require('dotenv').config();

const path = require('path');
const express = require('express');
const expressWs = require('express-ws');
const { DeepgramClient } = require('@deepgram/sdk');

const PORT = Number(process.env.PORT) || 3000;

// Proxy server keeps the API key server-side — clients never see it.
// This is the recommended pattern for browser-based apps that need
// Deepgram transcription or TTS without exposing secrets.

const LIVE_OPTIONS = {
  model: 'nova-3',
  encoding: 'linear16',
  sample_rate: 16000,
  channels: 1,
  smart_format: 'true',
  interim_results: 'true',
  utterance_end_ms: 1500,
  tag: 'deepgram-examples',
};

function createApp(options = {}) {
  const apiKey = options.apiKey || process.env.DEEPGRAM_API_KEY;
  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY is not set. Copy .env.example to .env and add your API key.');
  }

  const deepgram = new DeepgramClient({ apiKey });
  const app = express();
  const wsApp = expressWs(app);

  app.use(express.json());

  // ── REST proxy: pre-recorded transcription ──────────────────────────────
  // Client POSTs { url } or { buffer } and gets back the Deepgram response
  // without ever knowing the API key.
  app.post('/v1/listen', async (req, res) => {
    try {
      const { url, model, smart_format, diarize } = req.body;
      if (!url) {
        return res.status(400).json({ error: 'Request body must include "url"' });
      }

      const data = await deepgram.listen.v1.media.transcribeUrl({
        url,
        model: model || 'nova-3',
        smart_format: smart_format !== false,
        diarize: diarize === true,
        tag: 'deepgram-examples',
      });

      res.json(data);
    } catch (err) {
      console.error('[rest] Transcription error:', err.message);
      res.status(502).json({ error: 'Transcription failed', detail: err.message });
    }
  });

  // ── REST proxy: text-to-speech ──────────────────────────────────────────
  // Client POSTs { text } and gets back audio bytes.
  app.post('/v1/speak', async (req, res) => {
    try {
      const { text, model } = req.body;
      if (!text) {
        return res.status(400).json({ error: 'Request body must include "text"' });
      }

      const response = await deepgram.speak.v1.request(
        { text },
        { model: model || 'aura-2-en', tag: 'deepgram-examples' },
      );

      const stream = await response.getStream();
      if (!stream) {
        return res.status(502).json({ error: 'TTS returned no audio stream' });
      }

      res.setHeader('Content-Type', 'audio/mpeg');
      const reader = stream.getReader();
      const pump = async () => {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
        res.end();
      };
      await pump();
    } catch (err) {
      console.error('[rest] TTS error:', err.message);
      if (!res.headersSent) {
        res.status(502).json({ error: 'TTS failed', detail: err.message });
      }
    }
  });

  // ── WebSocket proxy: live STT ───────────────────────────────────────────
  // Client connects via WS, streams raw audio, receives JSON transcripts.
  // The server opens a parallel WS to Deepgram and bridges both sides.
  wsApp.app.ws('/v1/listen/stream', (browserWs) => {
    let dgConnection = null;
    let dgReady = false;
    const mediaQueue = [];

    console.log('[ws] Client connected');

    browserWs.on('message', (data) => {
      if (typeof data === 'string') return;

      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);

      if (dgReady && dgConnection) {
        try { dgConnection.sendMedia(buf); } catch {}
      } else {
        mediaQueue.push(buf);
      }
    });

    browserWs.on('close', () => {
      console.log('[ws] Client disconnected');
      if (dgConnection) {
        try { dgConnection.sendCloseStream({ type: 'CloseStream' }); } catch {}
        try { dgConnection.close(); } catch {}
        dgConnection = null;
      }
    });

    browserWs.on('error', (err) => {
      console.error('[ws] Client error:', err.message);
      if (dgConnection) {
        try { dgConnection.close(); } catch {}
        dgConnection = null;
      }
    });

    (async () => {
      dgConnection = await deepgram.listen.v1.connect({
        ...LIVE_OPTIONS,
        Authorization: `Token ${apiKey}`,
      });

      dgConnection.on('open', () => {
        console.log('[deepgram] Connection opened');
        dgReady = true;
        for (const chunk of mediaQueue) {
          try { dgConnection.sendMedia(chunk); } catch {}
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

  // ── Health check ────────────────────────────────────────────────────────
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'deepgram-proxy' });
  });

  // ── Serve the demo client ──────────────────────────────────────────────
  app.get('/', (_req, res) => {
    res.sendFile(path.join(__dirname, 'client.html'));
  });

  return app;
}

module.exports = { createApp, LIVE_OPTIONS };

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Deepgram proxy listening on http://localhost:${PORT}`);
    console.log(`  POST /v1/listen          — pre-recorded transcription`);
    console.log(`  POST /v1/speak           — text-to-speech`);
    console.log(`  WS   /v1/listen/stream   — live STT streaming`);
    console.log(`  GET  /health             — health check`);
    console.log(`  GET  /                   — demo client`);
  });
}
