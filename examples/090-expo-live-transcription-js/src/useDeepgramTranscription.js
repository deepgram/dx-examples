import { useState, useRef, useCallback } from 'react';

// Deepgram's live STT WebSocket endpoint. Query parameters configure the
// transcription model and behaviour — they're set once when the connection opens.
// This is simpler than sending a JSON config message after connecting.
const DG_WSS_BASE = 'wss://api.deepgram.com/v1/listen';

// Audio config that matches expo-av's recording preset.
// expo-av records in LINEAR16 (raw PCM) when using RECORDING_OPTION_ANDROID_OUTPUT_FORMAT_DEFAULT
// on Android and kAudioFormatLinearPCM on iOS. 16 kHz mono is the sweet spot:
// high enough for good accuracy, low enough to keep bandwidth manageable on mobile.
const AUDIO_CONFIG = {
  encoding: 'linear16',
  sample_rate: 16000,
  channels: 1,
};

// nova-3 is Deepgram's 2025 flagship model — best accuracy and lowest latency.
// smart_format adds punctuation, capitalisation, and number formatting (~10 ms overhead).
// interim_results gives partial transcripts while the speaker is still talking,
// which makes the UI feel responsive. Final results replace them when the
// utterance is complete.
const DEFAULT_DG_OPTIONS = {
  model: 'nova-3',
  smart_format: 'true',
  interim_results: 'true',
  utterance_end_ms: '1500',
};

export default function useDeepgramTranscription(apiKey) {
  const [transcript, setTranscript] = useState('');
  const [interimText, setInterimText] = useState('');
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  const wsRef = useRef(null);

  const connect = useCallback(() => {
    if (!apiKey) {
      setError('DEEPGRAM_API_KEY is required');
      return;
    }

    // Build the WebSocket URL with query parameters.
    // Each Deepgram option becomes a query param: ?model=nova-3&smart_format=true&...
    // The audio encoding params (encoding, sample_rate, channels) tell Deepgram
    // how to decode the raw bytes we'll send — if these don't match the actual
    // audio format, you'll get silence or garbage transcripts.
    const params = new URLSearchParams({ ...AUDIO_CONFIG, ...DEFAULT_DG_OPTIONS });
    const url = `${DG_WSS_BASE}?${params}`;

    // Deepgram authenticates WebSocket connections via the Authorization header.
    // React Native's WebSocket implementation supports custom headers — this is
    // NOT the case in browser JS where you'd need a server-side proxy.
    const ws = new WebSocket(url, null, {
      headers: { Authorization: `Token ${apiKey}` },
    });

    ws.onopen = () => {
      setIsConnected(true);
      setError(null);
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const text = data?.channel?.alternatives?.[0]?.transcript;
        if (!text) return;

        if (data.is_final) {
          // Final transcript for this utterance — append to the running transcript.
          // We add a space separator; smart_format handles capitalisation of
          // the first word in each sentence.
          setTranscript((prev) => (prev ? `${prev} ${text}` : text));
          setInterimText('');
        } else {
          // Interim (partial) result — display it but don't commit it.
          // Deepgram refines interim results as more audio arrives, so we
          // replace (not append) each time.
          setInterimText(text);
        }
      } catch {
        // Non-JSON messages (like UtteranceEnd) are safe to ignore.
      }
    };

    ws.onerror = (e) => {
      // Common causes: invalid API key (403), quota exceeded (402),
      // or network unreachable (mobile switching from WiFi to cellular).
      setError(e.message || 'WebSocket error');
      setIsConnected(false);
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    wsRef.current = ws;
  }, [apiKey]);

  // Send raw audio bytes to Deepgram. Call this from your audio recording callback.
  // The data should be a base64-encoded string of LINEAR16 PCM audio matching
  // the AUDIO_CONFIG above. expo-av's onRecordingStatusUpdate can provide this
  // when configured with the right output format.
  const sendAudio = useCallback((base64Data) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      // Convert base64 → binary. React Native's WebSocket supports sending
      // ArrayBuffer, Blob, or base64 strings directly depending on the platform.
      // Using atob + Uint8Array is the most portable approach.
      const binary = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
      wsRef.current.send(binary.buffer);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      // Sending a zero-length message tells Deepgram to flush any buffered
      // audio and return a final transcript. Without this, the last ~500 ms
      // of speech may be lost.
      if (wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(new ArrayBuffer(0));
      }
      wsRef.current.close();
      wsRef.current = null;
    }
    setIsConnected(false);
    setInterimText('');
  }, []);

  const reset = useCallback(() => {
    disconnect();
    setTranscript('');
    setError(null);
  }, [disconnect]);

  return {
    transcript,
    interimText,
    isConnected,
    error,
    connect,
    sendAudio,
    disconnect,
    reset,
  };
}
