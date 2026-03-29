'use strict';

// Slack bot that automatically transcribes audio and video file attachments
// using Deepgram nova-3. When a user posts a message with an audio/video file,
// the bot downloads it from Slack, sends the buffer to Deepgram's pre-recorded
// API, and replies in-thread with the transcript.
//
// Uses Socket Mode so no public URL or ngrok tunnel is needed — ideal for
// local development and internal Slack workspaces.

require('dotenv').config();

const { App } = require('@slack/bolt');
const { DeepgramClient } = require('@deepgram/sdk');
const https = require('https');

// Slack files have a mimetype field. These are the types Deepgram can handle.
// We check both mimetype and file extension because Slack sometimes reports
// a generic mimetype (e.g. "application/octet-stream") for valid audio files.
const AUDIO_MIMETYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/wav',
  'audio/x-wav',
  'audio/wave',
  'audio/flac',
  'audio/x-flac',
  'audio/ogg',
  'audio/webm',
  'audio/mp4',
  'audio/m4a',
  'audio/x-m4a',
  'audio/aac',
  'video/mp4',
  'video/webm',
  'video/quicktime',
]);

const AUDIO_EXTENSIONS = new Set([
  'mp3', 'wav', 'flac', 'ogg', 'webm', 'm4a', 'aac', 'mp4', 'opus', 'mov',
]);

function isAudioFile(file) {
  if (file.mimetype && AUDIO_MIMETYPES.has(file.mimetype.split(';')[0])) {
    return true;
  }
  // Fallback: check the file extension when mimetype is generic or missing.
  // Slack audio clips sometimes appear as "audio/webm" but uploaded files
  // may have a vague mimetype.
  const ext = (file.name || '').split('.').pop().toLowerCase();
  return AUDIO_EXTENSIONS.has(ext);
}

// Slack's file URLs (url_private_download) require the bot token in the
// Authorization header — they're not publicly accessible like some CDN URLs.
function downloadSlackFile(url, token) {
  return new Promise((resolve, reject) => {
    const options = {
      headers: { Authorization: `Bearer ${token}` },
    };
    https.get(url, options, (res) => {
      // Slack sometimes redirects file downloads — follow one redirect.
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadSlackFile(res.headers.location, token).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} downloading Slack file`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function transcribeBuffer(deepgram, buffer) {
  // SDK v5: transcribeFile() accepts a Buffer directly. The SDK sends it
  // as the request body with the appropriate Content-Type.
  // All options are a flat single object — not two arguments (that was v3/v4).
  // SDK v5 throws on errors — use try/catch, not { result, error } destructuring.
  const data = await deepgram.listen.v1.media.transcribeFile(buffer, {
    // nova-3 is the current flagship model (2025).
    // For phone call audio: 'nova-3-phonecall'
    // For medical dictation: 'nova-3-medical'
    model: 'nova-3',
    // smart_format adds punctuation, capitalisation, and number formatting.
    // Costs ~10ms extra but makes transcripts much more readable in Slack.
    smart_format: true,
    // Paragraph detection — useful for longer recordings. Each paragraph
    // becomes a separate block in the transcript.
    paragraphs: true,
  });

  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (!transcript || transcript.trim().length === 0) {
    return null;
  }
  return transcript;
}

async function main() {
  // Fail fast with clear messages rather than cryptic SDK errors.
  const required = ['DEEPGRAM_API_KEY', 'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN'];
  const missing = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error(`Error: missing environment variables: ${missing.join(', ')}`);
    console.error('Copy .env.example to .env and fill in your values.');
    process.exit(1);
  }

  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  // Socket Mode connects via WebSocket — no public URL needed.
  // This is ideal for development and internal bots. For production bots
  // serving many workspaces, switch to HTTP mode with a Request URL instead.
  const app = new App({
    token: process.env.SLACK_BOT_TOKEN,
    appToken: process.env.SLACK_APP_TOKEN,
    socketMode: true,
  });

  // Listen for all messages that contain file attachments.
  // We filter for audio files and ignore everything else silently —
  // the bot shouldn't spam channels by reacting to non-audio uploads.
  app.message(async ({ message, say }) => {
    // Slack sends subtypes for edits, joins, etc. — only process regular messages.
    // Bot messages also have a subtype ("bot_message") — skip those to avoid
    // infinite loops if the bot's own reply somehow triggers another event.
    if (message.subtype && message.subtype !== 'file_share') return;
    if (!message.files || message.files.length === 0) return;

    const audioFiles = message.files.filter(isAudioFile);
    if (audioFiles.length === 0) return;

    for (const file of audioFiles) {
      try {
        // Slack caps file downloads at the workspace's storage limit.
        // Deepgram handles up to ~2 GB, but we cap at 100 MB to keep
        // response times reasonable in a chat context.
        if (file.size > 100 * 1024 * 1024) {
          await say({
            text: `Skipping *${file.name}* — file is too large (>${Math.round(file.size / 1024 / 1024)} MB). Try a shorter recording.`,
            thread_ts: message.ts,
          });
          continue;
        }

        const buffer = await downloadSlackFile(
          file.url_private_download,
          process.env.SLACK_BOT_TOKEN,
        );

        const transcript = await transcribeBuffer(deepgram, buffer);

        if (!transcript) {
          await say({
            text: `No speech detected in *${file.name}*. Is the audio silent or very short?`,
            thread_ts: message.ts,
          });
          continue;
        }

        // Slack messages can be up to 40,000 characters (much more generous
        // than Discord's 2000). We still chunk at 3000 for readability.
        const header = `*Transcript of ${file.name}:*`;
        if (transcript.length <= 3000) {
          await say({
            text: `${header}\n\`\`\`${transcript}\`\`\``,
            thread_ts: message.ts,
          });
        } else {
          // For very long transcripts, post in blocks so Slack renders
          // them without truncation and the user can scroll through.
          await say({
            text: `${header} (${transcript.length.toLocaleString()} chars)`,
            thread_ts: message.ts,
          });
          const chunkSize = 3000;
          for (let i = 0; i < transcript.length; i += chunkSize) {
            await say({
              text: `\`\`\`${transcript.slice(i, i + chunkSize)}\`\`\``,
              thread_ts: message.ts,
            });
          }
        }
      } catch (err) {
        console.error(`Transcription error for ${file.name}:`, err);
        // Common causes:
        //   401 — bad Deepgram API key
        //   402 — free tier quota exceeded (not a code bug)
        //   400 — unsupported format or corrupted file
        //   Slack download error — bot token lacks files:read scope
        await say({
          text: `Sorry, couldn't transcribe *${file.name}*. Check the bot logs for details.`,
          thread_ts: message.ts,
        });
      }
    }
  });

  await app.start();
  console.log('Slack Transcription Bot is running (Socket Mode)');
  console.log('Post an audio file in any channel the bot is in to transcribe it.');
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
