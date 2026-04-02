import { DeepgramClient } from '@deepgram/sdk';

// Nitro WebSocket handler — proxies browser audio to Deepgram live STT
// and relays transcript JSON back to the browser. This keeps the API key
// server-side so it never reaches the client.
export default defineWebSocketHandler({
  async open(peer) {
    const config = useRuntimeConfig();
    if (!config.deepgramApiKey) {
      peer.send(JSON.stringify({ error: 'DEEPGRAM_API_KEY not configured' }));
      peer.close();
      return;
    }

    const deepgram = new DeepgramClient({ apiKey: config.deepgramApiKey });

    const dgConnection = await deepgram.listen.v1.connect({
      model: 'nova-3',
      encoding: 'linear16',
      sample_rate: 16000,
      channels: 1,
      smart_format: true,
      interim_results: true,
      utterance_end_ms: 1500,
      tag: 'deepgram-examples',
    });

    dgConnection.on('open', () => {
      console.log('[deepgram] STT connection opened');
    });

    dgConnection.on('error', (err: Error) => {
      console.error('[deepgram] STT error:', err.message);
    });

    dgConnection.on('close', () => {
      console.log('[deepgram] STT connection closed');
    });

    dgConnection.on('message', (data: unknown) => {
      try {
        peer.send(JSON.stringify(data));
      } catch {}
    });

    dgConnection.connect();
    await dgConnection.waitForOpen();

    // Store connection on the peer context so message/close handlers can use it
    (peer as any)._dgConnection = dgConnection;
    (peer as any)._mediaQueue = [] as Buffer[];
    (peer as any)._dgReady = true;
  },

  message(peer, message) {
    const dgConnection = (peer as any)._dgConnection;
    if (!dgConnection) return;

    // Binary audio frames from the browser
    const raw = message.rawData;
    if (raw instanceof ArrayBuffer || raw instanceof Uint8Array) {
      const buf = raw instanceof ArrayBuffer ? new Uint8Array(raw) : raw;
      try {
        dgConnection.sendBinary(buf);
      } catch {}
    }
  },

  close(peer) {
    const dgConnection = (peer as any)._dgConnection;
    if (dgConnection) {
      try { dgConnection.sendCloseStream({ type: 'CloseStream' }); } catch {}
      try { dgConnection.close(); } catch {}
      (peer as any)._dgConnection = null;
    }
  },

  error(peer, error) {
    console.error('[ws] Peer error:', error.message);
    const dgConnection = (peer as any)._dgConnection;
    if (dgConnection) {
      try { dgConnection.close(); } catch {}
      (peer as any)._dgConnection = null;
    }
  },
});
