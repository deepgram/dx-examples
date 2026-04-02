import { useCallback, useRef, useState } from 'react';

interface Transcript {
  text: string;
  speaker?: number;
}

type Status = 'idle' | 'connecting' | 'listening' | 'error';

// AudioWorklet processor sends 16-bit PCM at 16 kHz mono — matching the
// server's Deepgram encoding config.  We use AudioWorklet instead of
// MediaRecorder because MediaRecorder outputs Opus/webm which requires
// re-encoding on the server side.
const SAMPLE_RATE = 16000;

export function useTranscription() {
  const [status, setStatus] = useState<Status>('idle');
  const [transcripts, setTranscripts] = useState<Transcript[]>([]);
  const [interimText, setInterimText] = useState('');

  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);

  const start = useCallback(async () => {
    try {
      setStatus('connecting');
      setTranscripts([]);
      setInterimText('');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      streamRef.current = stream;

      const protocol = window.location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${protocol}://${window.location.host}/listen`);
      wsRef.current = ws;

      ws.binaryType = 'arraybuffer';

      ws.onopen = () => {
        setStatus('listening');

        // AudioContext downsamples the mic to 16 kHz and outputs linear16 PCM
        const audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
        ctxRef.current = audioCtx;

        const source = audioCtx.createMediaStreamSource(stream);

        // ScriptProcessorNode is simpler than AudioWorklet for an example and
        // works without a separate worklet file.  Buffer size 4096 at 16 kHz
        // yields ~256 ms chunks — a good balance between latency and overhead.
        const processor = audioCtx.createScriptProcessor(4096, 1, 1);

        processor.onaudioprocess = (e) => {
          if (ws.readyState !== WebSocket.OPEN) return;
          const float32 = e.inputBuffer.getChannelData(0);
          const int16 = new Int16Array(float32.length);
          for (let i = 0; i < float32.length; i++) {
            const s = Math.max(-1, Math.min(1, float32[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
          }
          ws.send(int16.buffer);
        };

        source.connect(processor);
        processor.connect(audioCtx.destination);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          if (data.error) {
            console.error('[deepgram]', data.error);
            setStatus('error');
            return;
          }

          const alt = data?.channel?.alternatives?.[0];
          const text = alt?.transcript;
          if (!text) return;

          if (data.is_final) {
            const speaker = alt?.words?.[0]?.speaker;
            setTranscripts((prev) => [...prev, { text, speaker }]);
            setInterimText('');
          } else {
            setInterimText(text);
          }
        } catch {}
      };

      ws.onerror = () => setStatus('error');
      ws.onclose = () => setStatus('idle');
    } catch (err) {
      console.error('Microphone access error:', err);
      setStatus('error');
    }
  }, []);

  const stop = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close();
      ctxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    setStatus('idle');
  }, []);

  return { status, transcripts, interimText, start, stop };
}
