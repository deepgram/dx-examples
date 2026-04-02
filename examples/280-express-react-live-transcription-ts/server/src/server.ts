import 'dotenv/config';

import path from 'path';
import express from 'express';
import expressWs from 'express-ws';
import cors from 'cors';
import { DeepgramClient } from '@deepgram/sdk';

const PORT = Number(process.env.PORT) || 3000;

// nova-3 with smart_format adds punctuation, capitalisation and number
// formatting at negligible latency cost.  interim_results makes the UI
// feel responsive — partial text appears while the speaker is still talking.
// diarize enables speaker labels when multiple speakers are detected.
const DEEPGRAM_LIVE_OPTIONS = {
  model: 'nova-3' as const,
  encoding: 'linear16' as const,   // ← browser AudioWorklet sends raw PCM
  sample_rate: 16000,
  channels: 1,
  smart_format: 'true' as const,
  interim_results: 'true' as const,
  utterance_end_ms: 1500,
  diarize: 'true' as const,        // ← THIS enables speaker diarization
  tag: 'deepgram-examples',
};

export function createApp() {
  const app = express();
  const wsApp = expressWs(app);

  if (!process.env.DEEPGRAM_API_KEY) {
    console.error('Error: DEEPGRAM_API_KEY environment variable is not set.');
    console.error('Copy .env.example to .env and add your API key.');
    process.exit(1);
  }

  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  app.use(cors());

  // In production, serve the built React client
  const clientDist = path.join(__dirname, '..', '..', 'client', 'dist');
  app.use(express.static(clientDist));

  // Browser connects here via WebSocket to stream microphone audio.
  // The server proxies each audio chunk to Deepgram and relays transcripts
  // back — keeping the API key server-side.
  wsApp.app.ws('/listen', (browserWs) => {
    let dgConnection: Awaited<ReturnType<typeof deepgram.listen.v1.connect>> | null = null;
    let dgReady = false;
    const mediaQueue: Buffer[] = [];

    console.log('[ws] Browser connected');

    browserWs.on('message', (data) => {
      if (typeof data === 'string') return;

      const buf = Buffer.isBuffer(data) ? data : Buffer.from(data as ArrayBuffer);

      if (dgReady && dgConnection) {
        try { dgConnection.sendMedia(buf); } catch {}
      } else {
        mediaQueue.push(buf);
      }
    });

    browserWs.on('close', () => {
      console.log('[ws] Browser disconnected');
      if (dgConnection) {
        try { dgConnection.sendCloseStream({ type: 'CloseStream' }); } catch {}
        try { dgConnection.close(); } catch {}
        (dgConnection as any) = null;
      }
    });

    browserWs.on('error', (err) => {
      console.error('[ws] Browser error:', err.message);
      if (dgConnection) {
        try { dgConnection.close(); } catch {}
        (dgConnection as any) = null;
      }
    });

    (async () => {
      dgConnection = await deepgram.listen.v1.connect({
        ...DEEPGRAM_LIVE_OPTIONS,
        Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
      });

      dgConnection.on('open', () => {
        console.log('[deepgram] Connection opened');
        dgReady = true;
        for (const chunk of mediaQueue) {
          try { dgConnection!.sendMedia(chunk); } catch {}
        }
        mediaQueue.length = 0;
      });

      dgConnection.on('error', (err) => {
        console.error('[deepgram] Error:', (err as Error).message);
        dgReady = false;
      });

      dgConnection.on('close', () => {
        console.log('[deepgram] Connection closed');
        dgReady = false;
        (dgConnection as any) = null;
      });

      dgConnection.on('message', (data: any) => {
        // data.channel.alternatives[0].transcript — the recognised text
        // data.is_final — true when Deepgram commits the utterance
        // data.channel.alternatives[0].words[].speaker — speaker index (0, 1, …)
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
    res.json({ status: 'ok', service: 'express-react-live-transcription' });
  });

  // SPA fallback — serves index.html for any non-API route so React
  // Router (if used) can handle client-side routing.
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });

  return app;
}

if (require.main === module) {
  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Server listening on http://localhost:${PORT}`);
    console.log(`  WS  /listen  — microphone audio proxy to Deepgram`);
    console.log(`  GET /health  — health check`);
  });
}
