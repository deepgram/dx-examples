'use strict';

require('dotenv').config();

const express = require('express');
const { DeepgramClient } = require('@deepgram/sdk');

const PORT = process.env.PORT || 3000;

function createApp(options = {}) {
  const apiKey = options.apiKey || process.env.DEEPGRAM_API_KEY;
  const riversideApiKey = options.riversideApiKey || process.env.RIVERSIDE_API_KEY;

  if (!apiKey) {
    throw new Error('DEEPGRAM_API_KEY is not set. Copy .env.example to .env and add your key.');
  }
  if (!riversideApiKey) {
    throw new Error('RIVERSIDE_API_KEY is not set. Copy .env.example to .env and add your key.');
  }

  const deepgram = new DeepgramClient({ apiKey });
  const app = express();
  app.use(express.json());

  // Health check for load balancers / uptime monitors
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // POST /webhook/riverside — receives Riverside recording.completed events.
  // Riverside sends a JSON payload with recording metadata including per-track
  // download URLs. Each track is one participant's isolated audio.
  app.post('/webhook/riverside', async (req, res) => {
    try {
      const event = req.body;

      if (event.type !== 'recording.completed') {
        return res.status(200).json({ message: 'Event ignored', type: event.type });
      }

      const tracks = event.tracks || [];
      if (tracks.length === 0) {
        return res.status(400).json({ error: 'No tracks found in recording.completed event' });
      }

      const merged = await transcribeAndMergeTracks(deepgram, tracks, riversideApiKey);

      res.status(200).json(merged);
    } catch (err) {
      console.error('Webhook processing error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /transcribe — manual endpoint for testing without webhooks.
  // Accepts { tracks: [{ participant_name, download_url }] } and transcribes them.
  app.post('/transcribe', async (req, res) => {
    try {
      const { tracks } = req.body;
      if (!tracks || tracks.length === 0) {
        return res.status(400).json({ error: 'Request body must include a non-empty "tracks" array' });
      }

      const merged = await transcribeAndMergeTracks(deepgram, tracks, riversideApiKey);
      res.status(200).json(merged);
    } catch (err) {
      console.error('Transcription error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  return app;
}

// Transcribes each track separately then merges results into a single
// speaker-labelled transcript ordered by timestamp.
// Diarization is disabled because Riverside already isolates each participant
// into their own audio track — one speaker per file.
async function transcribeAndMergeTracks(deepgram, tracks, riversideApiKey) {
  const trackResults = await Promise.all(
    tracks.map(async (track) => {
      const url = buildTrackUrl(track, riversideApiKey);
      const speakerName = track.participant_name || track.name || 'Unknown';

      // Diarize is false — each track is already a single speaker.
      // smart_format adds punctuation and casing for readability.
      const result = await deepgram.listen.v1.media.transcribeUrl(
        { url },
        {
          model: 'nova-3',
          smart_format: true,
          diarize: false,
          tag: 'deepgram-examples', // ← REQUIRED: tags usage in Deepgram console
        }
      );

      return { speakerName, result };
    })
  );

  return mergeSpeakerTranscripts(trackResults);
}

// Riverside download URLs require an API key as a query parameter
// for authenticated access to the recording files. Only appended
// for riverside.fm domains so third-party URLs pass through untouched.
function buildTrackUrl(track, riversideApiKey) {
  const rawUrl = track.download_url || track.url;
  if (!rawUrl) {
    throw new Error(`Track "${track.participant_name || 'unknown'}" has no download URL`);
  }
  const parsed = new URL(rawUrl);
  const isRiverside = parsed.hostname.includes('riverside.fm') || parsed.hostname.includes('riverside');
  if (isRiverside && riversideApiKey && !parsed.searchParams.has('api_key')) {
    parsed.searchParams.set('api_key', riversideApiKey);
  }
  return parsed.toString();
}

// Merge per-track transcripts into a single timeline.
// Each word from each track is tagged with the speaker name,
// then all words are sorted by start time to interleave speakers correctly.
function mergeSpeakerTranscripts(trackResults) {
  const allWords = [];

  for (const { speakerName, result } of trackResults) {
    const channel = result?.results?.channels?.[0];
    const alt = channel?.alternatives?.[0];
    if (!alt) continue;

    for (const word of alt.words || []) {
      allWords.push({
        speaker: speakerName,
        word: word.punctuated_word || word.word,
        start: word.start,
        end: word.end,
        confidence: word.confidence,
      });
    }
  }

  // Sort chronologically so interleaved speech reads in order
  allWords.sort((a, b) => a.start - b.start);

  // Build a readable transcript grouping consecutive words from the same speaker
  const segments = [];
  let current = null;

  for (const w of allWords) {
    if (!current || current.speaker !== w.speaker) {
      if (current) segments.push(current);
      current = { speaker: w.speaker, start: w.start, end: w.end, text: w.word };
    } else {
      current.text += ' ' + w.word;
      current.end = w.end;
    }
  }
  if (current) segments.push(current);

  const transcript = segments
    .map((s) => `[${s.speaker}] ${s.text}`)
    .join('\n');

  return {
    transcript,
    segments,
    word_count: allWords.length,
    track_count: trackResults.length,
    speakers: [...new Set(trackResults.map((t) => t.speakerName))],
  };
}

module.exports = { createApp, transcribeAndMergeTracks, mergeSpeakerTranscripts, buildTrackUrl };

if (require.main === module) {
  if (!process.env.DEEPGRAM_API_KEY) {
    console.error('Error: DEEPGRAM_API_KEY environment variable is not set.');
    console.error('Copy .env.example to .env and add your API key.');
    process.exit(1);
  }
  if (!process.env.RIVERSIDE_API_KEY) {
    console.error('Error: RIVERSIDE_API_KEY environment variable is not set.');
    console.error('Copy .env.example to .env and add your API key.');
    process.exit(1);
  }

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Riverside → Deepgram transcription server running on port ${PORT}`);
    console.log(`Webhook endpoint: POST http://localhost:${PORT}/webhook/riverside`);
    console.log(`Manual endpoint:  POST http://localhost:${PORT}/transcribe`);
  });
}
