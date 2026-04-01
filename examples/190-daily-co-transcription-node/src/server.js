'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const express = require('express');
const expressWs = require('express-ws');
const path = require('path');
const { DeepgramClient } = require('@deepgram/sdk');

const PORT = process.env.PORT || 3000;

const DEEPGRAM_LIVE_OPTIONS = {
  model: 'nova-3',
  encoding: 'linear16',
  sample_rate: 16000,
  channels: 1,
  smart_format: true,
  interim_results: true,
  utterance_end_ms: 1500,
  punctuate: true,
  diarize: true, // ← THIS enables speaker labels for multi-participant calls
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
  if (!process.env.DAILY_API_KEY) {
    console.error('Error: DAILY_API_KEY environment variable is not set.');
    console.error('Copy .env.example to .env and add your Daily API key.');
    process.exit(1);
  }

  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  app.use(express.static(path.join(__dirname, 'public')));

  // Create a temporary Daily room via REST API
  app.post('/api/room', async (req, res) => {
    try {
      const response = await fetch('https://api.daily.co/v1/rooms', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${process.env.DAILY_API_KEY}`,
        },
        body: JSON.stringify({
          properties: {
            exp: Math.floor(Date.now() / 1000) + 1800, // ← 30 min expiry
            enable_chat: false,
          },
        }),
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Daily API ${response.status}: ${text}`);
      }

      const room = await response.json();
      // room.url = "https://your-domain.daily.co/room-name"
      // room.name = "room-name"
      res.json({ url: room.url, name: room.name });
      console.log(`[daily] Room created: ${room.url}`);
    } catch (err) {
      console.error('[daily] Room creation failed:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // WebSocket endpoint: browser streams audio here, server forwards to Deepgram
  app.ws('/transcribe', (clientWs) => {
    let dgConnection = null;
    let dgReady = false;
    const mediaQueue = [];

    console.log('[ws] Client connected for transcription');

    clientWs.on('message', (raw) => {
      // Binary frames are audio; text frames are control messages
      if (typeof raw !== 'string' && Buffer.isBuffer(raw)) {
        if (dgReady && dgConnection) {
          try { dgConnection.send(raw); } catch {}
        } else {
          mediaQueue.push(raw);
        }
        return;
      }

      try {
        const msg = JSON.parse(raw);
        if (msg.type === 'stop') {
          console.log('[ws] Client requested stop');
          if (dgConnection) {
            try { dgConnection.finish(); } catch {}
          }
        }
      } catch {}
    });

    clientWs.on('close', () => {
      console.log('[ws] Client disconnected');
      if (dgConnection) {
        try { dgConnection.finish(); } catch {}
        dgConnection = null;
      }
    });

    clientWs.on('error', (err) => {
      console.error('[ws] Client error:', err.message);
      if (dgConnection) {
        try { dgConnection.finish(); } catch {}
        dgConnection = null;
      }
    });

    (async () => {
      dgConnection = deepgram.listen.v1.live(DEEPGRAM_LIVE_OPTIONS);

      dgConnection.on('open', () => {
        console.log('[deepgram] Connection opened');
        dgReady = true;
        for (const buf of mediaQueue) {
          try { dgConnection.send(buf); } catch {}
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
        try {
          const msg = typeof data === 'string' ? JSON.parse(data) : data;
          const alt = msg?.channel?.alternatives?.[0];
          if (alt?.transcript) {
            const payload = {
              transcript: alt.transcript,
              is_final: msg.is_final,
              speaker: alt.words?.[0]?.speaker ?? null, // ← diarize speaker index
              confidence: alt.confidence,
            };

            if (clientWs.readyState === 1) {
              clientWs.send(JSON.stringify(payload));
            }

            const tag = msg.is_final ? 'final' : 'interim';
            const spk = payload.speaker !== null ? ` [speaker ${payload.speaker}]` : '';
            console.log(`[${tag}]${spk} ${alt.transcript}`);
          }
        } catch {}
      });
    })().catch((err) => {
      console.error('[deepgram] Setup failed:', err.message);
    });
  });

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'deepgram-daily-co-transcription' });
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log(`  GET  /            — Client UI`);
    console.log(`  POST /api/room    — Create Daily room`);
    console.log(`  WS   /transcribe  — Audio→Deepgram WebSocket`);
    console.log(`  GET  /api/health  — Health check`);
  });
}

module.exports = { createApp };
