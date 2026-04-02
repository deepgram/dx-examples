import 'dotenv/config';
import { WebSocketServer, WebSocket } from 'ws';
import { DeepgramClient } from '@deepgram/sdk';
import { handler } from '../build/handler.js';
import http from 'http';

const PORT = parseInt(process.env.PORT || '3000', 10);

const DEEPGRAM_LIVE_OPTIONS = {
	model: 'nova-3' as const,
	encoding: 'linear16' as const,
	sample_rate: 16000,
	channels: 1,
	smart_format: true,
	interim_results: true,
	utterance_end_ms: 1500,
	tag: 'deepgram-examples' as const
};

if (!process.env.DEEPGRAM_API_KEY) {
	console.error('Error: DEEPGRAM_API_KEY is not set. Copy .env.example to .env and add your key.');
	process.exit(1);
}

const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
const server = http.createServer(handler);
const wss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
	if (req.url !== '/api/listen') return;

	wss.handleUpgrade(req, socket, head, (ws) => {
		wss.emit('connection', ws, req);
	});
});

wss.on('connection', (browserWs: WebSocket) => {
	let dgConnection: any = null;
	let dgReady = false;
	const mediaQueue: Buffer[] = [];

	console.log('[ws] Browser connected');

	browserWs.on('message', (data: any) => {
		if (typeof data === 'string') return;

		if (dgReady && dgConnection) {
			try { dgConnection.sendBinary(data); } catch {}
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

	browserWs.on('error', (err: Error) => {
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

		dgConnection.on('error', (err: Error) => {
			console.error('[deepgram] Error:', err.message);
			dgReady = false;
		});

		dgConnection.on('close', () => {
			console.log('[deepgram] Connection closed');
			dgReady = false;
			dgConnection = null;
		});

		dgConnection.on('message', (data: any) => {
			if (browserWs.readyState === WebSocket.OPEN) {
				browserWs.send(JSON.stringify(data));
			}
		});

		dgConnection.connect();
		await dgConnection.waitForOpen();
	})().catch((err) => {
		console.error('[deepgram] Setup failed:', err.message);
		if (browserWs.readyState === WebSocket.OPEN) {
			browserWs.send(JSON.stringify({ error: 'Deepgram connection failed' }));
			browserWs.close();
		}
	});
});

server.listen(PORT, () => {
	console.log(`Server listening on http://localhost:${PORT}`);
});
