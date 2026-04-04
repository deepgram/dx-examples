'use strict';

require('dotenv').config();

const crypto = require('crypto');
const express = require('express');
const { DeepgramClient } = require('@deepgram/sdk');

const PORT = process.env.PORT || 3000;

const REQUIRED_ENV = [
  'DEEPGRAM_API_KEY',
  'WEBEX_BOT_TOKEN',
  'WEBEX_WEBHOOK_SECRET',
];

function createApp() {
  const webhookSecret = process.env.WEBEX_WEBHOOK_SECRET;
  const botToken = process.env.WEBEX_BOT_TOKEN;

  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  const app = express();

  // Capture raw body for HMAC verification before JSON parsing.
  app.use(express.json({
    verify: (req, _res, buf) => { req.rawBody = buf; },
  }));

  // ── Webex webhook endpoint ──────────────────────────────────────────────────
  // Webex fires webhooks for events you subscribe to.
  // We listen for "meetingRecording.ready" — fired when a meeting recording
  // has been processed and is available for download.
  app.post('/webhook', async (req, res) => {
    // ← THIS verifies the webhook came from Webex by checking the HMAC-SHA1
    // signature in the x-spark-signature header against our shared secret.
    const signature = req.headers['x-spark-signature'];
    if (webhookSecret && signature) {
      const expected = crypto
        .createHmac('sha1', webhookSecret)
        .update(req.rawBody)
        .digest('hex');

      if (signature !== expected) {
        console.error('Invalid webhook signature — rejecting request');
        return res.status(401).json({ error: 'Invalid signature' });
      }
    }

    const { resource, event, data } = req.body;

    if (resource !== 'meetingRecordings' || event !== 'ready') {
      return res.json({ status: 'ignored', resource, event });
    }

    res.json({ status: 'processing' });

    try {
      await handleRecordingReady(data, deepgram, botToken);
    } catch (err) {
      console.error('Error processing recording:', err.message);
    }
  });

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  return app;
}

// ── Recording handler ──────────────────────────────────────────────────────────
// When a recording is ready, Webex sends the recording ID in the webhook data.
// We fetch the recording details, download the audio, and transcribe with Deepgram.
async function handleRecordingReady(data, deepgram, botToken) {
  const recordingId = data.id;
  if (!recordingId) {
    console.log('No recording ID in webhook data');
    return;
  }

  console.log(`\nFetching recording details for: ${recordingId}`);

  // ← THIS fetches the recording metadata including the download URL.
  // The Webex Recordings API requires a bot or user token with spark:recordings_read scope.
  const detailResp = await fetch(
    `https://webexapis.com/v1/recordings/${recordingId}`,
    { headers: { Authorization: `Bearer ${botToken}` } }
  );

  if (!detailResp.ok) {
    throw new Error(`Failed to fetch recording details: ${detailResp.status} ${await detailResp.text()}`);
  }

  const recording = await detailResp.json();
  const topic = recording.topic || recording.meetingId || 'Untitled Meeting';
  console.log(`Processing: "${topic}"`);
  console.log(`Format: ${recording.format}, Duration: ${recording.durationSeconds}s`);

  // ← THIS downloads the actual audio/video file from Webex.
  // temporaryDirectDownloadLinks.audioDownloadLink is preferred — smaller file, faster transcription.
  const downloadUrl =
    recording.temporaryDirectDownloadLinks?.audioDownloadLink ||
    recording.temporaryDirectDownloadLinks?.recordingDownloadLink;

  if (!downloadUrl) {
    throw new Error('No download link available — recording may still be processing');
  }

  const downloadResp = await fetch(downloadUrl);
  if (!downloadResp.ok) {
    throw new Error(`Failed to download recording: ${downloadResp.status}`);
  }

  const audioBuffer = Buffer.from(await downloadResp.arrayBuffer());
  console.log(`Downloaded ${(audioBuffer.length / 1024 / 1024).toFixed(1)} MB`);

  // ← THIS sends the audio to Deepgram for transcription.
  // transcribeFile takes (buffer, options) — buffer is the first arg.
  // diarize: true enables speaker labels — essential for multi-speaker meetings.
  // paragraphs: true produces readable paragraph-segmented output.
  const result = await deepgram.listen.v1.media.transcribeFile(audioBuffer, {
    model: 'nova-3',
    smart_format: true,
    diarize: true,
    paragraphs: true,
    tag: 'deepgram-examples',
  });

  // result.results.channels[0].alternatives[0].transcript
  const transcript = result.results.channels[0].alternatives[0].transcript;
  const paragraphs = result.results.channels[0].alternatives[0].paragraphs;

  console.log(`\n── Transcript: "${topic}" ──`);
  console.log(transcript);

  if (paragraphs?.paragraphs) {
    console.log(`\n── Paragraphs: ${paragraphs.paragraphs.length} ──`);
  }

  const words = result.results.channels[0].alternatives[0].words;
  if (words?.length > 0) {
    const duration = words.at(-1).end;
    console.log(`\nDuration: ${(duration / 60).toFixed(1)} min | Words: ${words.length}`);
  }

  // ← THIS posts the transcript back to a Webex space if the recording has a roomId.
  // In production you'd resolve the meeting to a space; here we log the transcript.
  if (data.roomId && botToken) {
    try {
      const summary = transcript.length > 7000
        ? transcript.slice(0, 7000) + '\n\n… (truncated)'
        : transcript;

      await fetch('https://webexapis.com/v1/messages', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${botToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          roomId: data.roomId,
          markdown: `**Meeting Transcript: ${topic}**\n\n${summary}`,
        }),
      });
      console.log('Transcript posted to Webex space');
    } catch (err) {
      console.error('Failed to post transcript to space:', err.message);
    }
  }

  return { topic, transcript };
}

module.exports = { createApp, handleRecordingReady };

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
    console.log(`Webex recording transcription server running on port ${PORT}`);
    console.log(`Webhook endpoint: POST http://localhost:${PORT}/webhook`);
    console.log(`Health check:     GET  http://localhost:${PORT}/health`);
  });
}
