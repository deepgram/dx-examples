'use strict';

require('dotenv').config();

const express = require('express');
const { DeepgramClient } = require('@deepgram/sdk');

const PORT = process.env.PORT || 3000;

const REQUIRED_ENV = ['DEEPGRAM_API_KEY', 'LOOM_API_KEY'];

// Loom Public API base URL — requires a Developer API key from the Loom developer portal.
// Docs: https://developers.loom.com
const LOOM_API_BASE = 'https://developer.loom.com/v1';

/**
 * Fetch video metadata from the Loom Public API.
 *
 * The Loom API returns an object with title, download_url (an mp4 CDN link),
 * duration, and other metadata. The download_url is time-limited — use it
 * promptly after fetching.
 *
 * @param {string} videoId - The Loom video ID (from the share URL path).
 * @param {string} apiKey  - Loom Developer API key.
 * @returns {Promise<object>} Loom video metadata including download_url.
 */
async function fetchLoomVideo(videoId, apiKey) {
  const resp = await fetch(`${LOOM_API_BASE}/videos/${videoId}`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Loom API error ${resp.status}: ${text}`);
  }

  return resp.json();
}

/**
 * Download video content from a URL and return it as a Buffer.
 *
 * @param {string} url - The download URL (e.g. Loom CDN mp4 link).
 * @returns {Promise<Buffer>} The downloaded file as a Buffer.
 */
async function downloadVideo(url) {
  const resp = await fetch(url);

  if (!resp.ok) {
    throw new Error(`Download failed: ${resp.status} ${resp.statusText}`);
  }

  return Buffer.from(await resp.arrayBuffer());
}

/**
 * Transcribe a video buffer using Deepgram pre-recorded STT.
 *
 * Deepgram accepts video files directly — no need to extract the audio track
 * first. The SDK handles format detection automatically.
 *
 * @param {import('@deepgram/sdk').DeepgramClient} deepgram - Initialized Deepgram client.
 * @param {Buffer} videoBuffer - Raw video file bytes.
 * @returns {Promise<object>} Deepgram transcription response.
 */
async function transcribeVideo(deepgram, videoBuffer) {
  // SDK v5: transcribeFile takes (buffer, options) — flat options object.
  // SDK v5: throws on error — use try/catch, not { result, error }.
  return deepgram.listen.v1.media.transcribeFile(videoBuffer, {
    model: 'nova-3',
    smart_format: true,
    // ← THIS enables paragraph detection for readable long-form output.
    paragraphs: true,
    // ← THIS enables speaker labels — useful for multi-speaker Loom recordings.
    diarize: true,
    tag: 'deepgram-examples',
  });
}

/**
 * Extract a Loom video ID from various URL formats.
 *
 * Supports:
 *   - https://www.loom.com/share/{id}
 *   - https://www.loom.com/share/{id}?sid={sid}
 *   - https://loom.com/share/{id}
 *   - bare video ID string
 *
 * @param {string} input - A Loom share URL or bare video ID.
 * @returns {string|null} The video ID, or null if the format is unrecognised.
 */
function extractVideoId(input) {
  if (!input) return null;

  const urlMatch = input.match(
    /(?:https?:\/\/)?(?:www\.)?loom\.com\/share\/([a-f0-9]+)/i
  );
  if (urlMatch) return urlMatch[1];

  if (/^[a-f0-9]{16,}$/i.test(input)) return input;

  return null;
}

/**
 * Create and configure the Express application.
 *
 * Separated from app.listen() so tests can import it without binding a port.
 *
 * @returns {import('express').Application} Configured Express app.
 */
function createApp() {
  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  const app = express();
  app.use(express.json());

  // ── POST /transcribe ────────────────────────────────────────────────────────
  // Accepts a Loom share URL or video ID, fetches the video from the Loom API,
  // and returns the Deepgram transcript.
  //
  // Request body: { "url": "https://www.loom.com/share/{id}" }
  //   — or —
  // Request body: { "videoId": "{id}" }
  //
  // This endpoint is what a frontend using the Loom Record SDK would call
  // after the "insert-click" event fires with the video's sharedUrl.
  app.post('/transcribe', async (req, res) => {
    try {
      const videoId = extractVideoId(req.body.url) || req.body.videoId;

      if (!videoId) {
        return res.status(400).json({
          error: 'Missing or invalid Loom URL. Send { "url": "https://www.loom.com/share/{id}" }',
        });
      }

      const loomApiKey = process.env.LOOM_API_KEY;
      if (!loomApiKey) {
        return res.status(500).json({ error: 'LOOM_API_KEY not configured' });
      }

      console.log(`Fetching Loom video metadata: ${videoId}`);
      const videoMeta = await fetchLoomVideo(videoId, loomApiKey);
      const title = videoMeta.title || 'Untitled Loom Video';
      const downloadUrl = videoMeta.download_url;

      if (!downloadUrl) {
        return res.status(422).json({
          error: 'Loom API did not return a download URL for this video',
        });
      }

      console.log(`Downloading video: "${title}"`);
      const videoBuffer = await downloadVideo(downloadUrl);
      console.log(`Downloaded ${(videoBuffer.length / 1024 / 1024).toFixed(1)} MB`);

      console.log('Sending to Deepgram for transcription...');
      const data = await transcribeVideo(deepgram, videoBuffer);

      // data.results.channels[0].alternatives[0].transcript
      const transcript = data.results.channels[0].alternatives[0].transcript;
      const words = data.results.channels[0].alternatives[0].words || [];
      const duration = words.length > 0 ? words.at(-1).end : 0;

      console.log(`Transcription complete: ${words.length} words, ${duration.toFixed(1)}s`);

      res.json({
        videoId,
        title,
        duration,
        wordCount: words.length,
        transcript,
      });
    } catch (err) {
      console.error('Transcription error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  return app;
}

module.exports = {
  createApp,
  extractVideoId,
  fetchLoomVideo,
  downloadVideo,
  transcribeVideo,
};

if (require.main === module) {
  for (const key of REQUIRED_ENV) {
    if (!process.env[key]) {
      console.error(`Error: ${key} environment variable is not set.`);
      console.error('Copy .env.example to .env and add your credentials.');
      process.exit(1);
    }
  }

  const app = createApp();
  app.listen(PORT, () => {
    console.log(`Loom transcription server running on port ${PORT}`);
    console.log(`Transcribe endpoint: POST http://localhost:${PORT}/transcribe`);
    console.log(`Health check:        GET  http://localhost:${PORT}/health`);
  });
}
