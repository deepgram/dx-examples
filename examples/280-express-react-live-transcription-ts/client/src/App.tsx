import { useState } from 'react';
import { useTranscription } from './useTranscription';

export default function App() {
  const { status, transcripts, interimText, start, stop } = useTranscription();
  const [showInterim, setShowInterim] = useState(true);

  const isListening = status === 'listening';

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>Deepgram Live Transcription</h1>
        <p style={styles.subtitle}>
          Express.js + React &middot; Nova-3 &middot; Speaker Diarization
        </p>
      </header>

      <main style={styles.main}>
        <div style={styles.controls}>
          <button
            onClick={isListening ? stop : start}
            style={{
              ...styles.button,
              backgroundColor: isListening ? '#dc2626' : '#10b981',
            }}
          >
            {isListening ? 'Stop' : 'Start'} Listening
          </button>

          <label style={styles.label}>
            <input
              type="checkbox"
              checked={showInterim}
              onChange={(e) => setShowInterim(e.target.checked)}
            />
            Show interim results
          </label>

          <span style={styles.status}>
            {status === 'idle' && 'Ready'}
            {status === 'connecting' && 'Connecting…'}
            {status === 'listening' && '● Recording'}
            {status === 'error' && 'Error — check console'}
          </span>
        </div>

        <div style={styles.transcriptBox}>
          {transcripts.map((t, i) => (
            <p key={i} style={styles.final}>
              {t.speaker !== undefined && (
                <span style={styles.speaker}>Speaker {t.speaker}: </span>
              )}
              {t.text}
            </p>
          ))}

          {showInterim && interimText && (
            <p style={styles.interim}>{interimText}</p>
          )}

          {transcripts.length === 0 && !interimText && (
            <p style={styles.placeholder}>
              Transcripts will appear here…
            </p>
          )}
        </div>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 720,
    margin: '0 auto',
    padding: '2rem 1rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    color: '#1f2937',
  },
  header: { textAlign: 'center', marginBottom: '1.5rem' },
  title: { margin: 0, fontSize: '1.5rem' },
  subtitle: { margin: '0.25rem 0 0', color: '#6b7280', fontSize: '0.875rem' },
  main: { display: 'flex', flexDirection: 'column', gap: '1rem' },
  controls: {
    display: 'flex',
    alignItems: 'center',
    gap: '1rem',
    flexWrap: 'wrap',
  },
  button: {
    padding: '0.5rem 1.25rem',
    color: '#fff',
    border: 'none',
    borderRadius: 6,
    fontSize: '0.9rem',
    cursor: 'pointer',
  },
  label: { fontSize: '0.85rem', display: 'flex', alignItems: 'center', gap: 4 },
  status: { fontSize: '0.85rem', color: '#6b7280', marginLeft: 'auto' },
  transcriptBox: {
    minHeight: 300,
    border: '1px solid #e5e7eb',
    borderRadius: 8,
    padding: '1rem',
    overflowY: 'auto',
    backgroundColor: '#fafafa',
  },
  final: { margin: '0.35rem 0', lineHeight: 1.5 },
  interim: { margin: '0.35rem 0', lineHeight: 1.5, color: '#9ca3af', fontStyle: 'italic' },
  speaker: { fontWeight: 600, color: '#4f46e5' },
  placeholder: { color: '#9ca3af', fontStyle: 'italic' },
};
