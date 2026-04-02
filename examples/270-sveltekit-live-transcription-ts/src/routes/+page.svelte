<script lang="ts">
	const SAMPLE_RATE = 16000;

	let isListening = $state(false);
	let status = $state('Click Start to begin');
	let transcript = $state('');
	let interimTranscript = $state('');

	let ws: WebSocket | null = null;
	let audioContext: AudioContext | null = null;
	let processor: ScriptProcessorNode | null = null;
	let mediaStream: MediaStream | null = null;

	async function startListening() {
		try {
			status = 'Requesting microphone access...';
			mediaStream = await navigator.mediaDevices.getUserMedia({
				audio: { sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: true }
			});

			audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
			const source = audioContext.createMediaStreamSource(mediaStream);

			// ScriptProcessorNode captures raw PCM — we convert float32 to int16
			// for Deepgram's linear16 encoding requirement
			processor = audioContext.createScriptProcessor(4096, 1, 1);

			const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
			ws = new WebSocket(`${protocol}//${window.location.host}/api/listen`);

			ws.onopen = () => {
				status = 'Connected — speak now';
				isListening = true;
			};

			ws.onmessage = (event) => {
				const data = JSON.parse(event.data);

				if (data.error) {
					status = `Error: ${data.error}`;
					stopListening();
					return;
				}

				const alt = data.channel?.alternatives?.[0];
				if (!alt) return;

				if (data.is_final) {
					if (alt.transcript) {
						transcript = transcript ? transcript + ' ' + alt.transcript : alt.transcript;
					}
					interimTranscript = '';
				} else {
					interimTranscript = alt.transcript || '';
				}
			};

			ws.onerror = () => {
				status = 'WebSocket error';
				stopListening();
			};

			ws.onclose = () => {
				if (isListening) {
					status = 'Connection closed';
					isListening = false;
				}
			};

			processor.onaudioprocess = (e) => {
				if (!ws || ws.readyState !== WebSocket.OPEN) return;

				const input = e.inputBuffer.getChannelData(0);
				const pcm = new Int16Array(input.length);
				for (let i = 0; i < input.length; i++) {
					const s = Math.max(-1, Math.min(1, input[i]));
					pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
				}
				ws.send(pcm.buffer);
			};

			source.connect(processor);
			processor.connect(audioContext.destination);
		} catch (err: any) {
			status = `Error: ${err.message}`;
			stopListening();
		}
	}

	function stopListening() {
		if (ws?.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify({ type: 'CloseStream' }));
			ws.close();
		}
		ws = null;

		processor?.disconnect();
		processor = null;

		audioContext?.close();
		audioContext = null;

		mediaStream?.getTracks().forEach((t) => t.stop());
		mediaStream = null;

		isListening = false;
		interimTranscript = '';
		status = 'Stopped';
	}

	function clearTranscript() {
		transcript = '';
		interimTranscript = '';
	}
</script>

<main>
	<h1>SvelteKit + Deepgram Live Transcription</h1>
	<p class="status">{status}</p>

	<div class="controls">
		{#if isListening}
			<button onclick={stopListening} class="stop">Stop Listening</button>
		{:else}
			<button onclick={startListening} class="start">Start Listening</button>
		{/if}
		<button onclick={clearTranscript} class="clear" disabled={!transcript && !interimTranscript}>
			Clear
		</button>
	</div>

	<div class="transcript-box">
		{#if transcript || interimTranscript}
			<p>
				<span class="final">{transcript}</span>
				{#if interimTranscript}
					<span class="interim">{interimTranscript}</span>
				{/if}
			</p>
		{:else}
			<p class="placeholder">Transcription will appear here...</p>
		{/if}
	</div>
</main>

<style>
	:global(body) {
		font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
		margin: 0;
		padding: 2rem;
		background: #f5f5f5;
		color: #333;
	}

	main {
		max-width: 720px;
		margin: 0 auto;
	}

	h1 {
		font-size: 1.5rem;
		margin-bottom: 0.5rem;
	}

	.status {
		color: #666;
		font-size: 0.9rem;
		margin-bottom: 1rem;
	}

	.controls {
		display: flex;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}

	button {
		padding: 0.6rem 1.2rem;
		border: none;
		border-radius: 6px;
		font-size: 1rem;
		cursor: pointer;
		transition: background 0.2s;
	}

	button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	.start {
		background: #13ef93;
		color: #000;
	}

	.start:hover {
		background: #0fd882;
	}

	.stop {
		background: #ef4444;
		color: #fff;
	}

	.stop:hover {
		background: #dc2626;
	}

	.clear {
		background: #e5e7eb;
		color: #333;
	}

	.clear:hover:not(:disabled) {
		background: #d1d5db;
	}

	.transcript-box {
		background: #fff;
		border: 1px solid #e5e7eb;
		border-radius: 8px;
		padding: 1.5rem;
		min-height: 200px;
		line-height: 1.6;
	}

	.final {
		color: #111;
	}

	.interim {
		color: #9ca3af;
	}

	.placeholder {
		color: #9ca3af;
		font-style: italic;
	}
</style>
