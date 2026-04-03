'use strict';

// WhatsApp Business Cloud API webhook server that transcribes incoming voice
// messages using Deepgram nova-3 and replies with the transcript.
//
// Architecture:
//   1. Meta sends webhook events to this server when a WhatsApp message arrives
//   2. We filter for audio messages (voice notes, audio attachments)
//   3. Download the media from Meta's CDN using the WhatsApp token
//   4. Send the audio buffer to Deepgram's pre-recorded STT API
//   5. Reply to the sender with the transcript via the WhatsApp Cloud API

require('dotenv').config();

const express = require('express');
const https = require('https');
const { DeepgramClient } = require('@deepgram/sdk');

const PORT = process.env.PORT || 3000;

const REQUIRED_ENV = [
  'DEEPGRAM_API_KEY',
  'WHATSAPP_TOKEN',
  'WHATSAPP_VERIFY_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
];

const missing = REQUIRED_ENV.filter(k => !process.env[k]);
if (missing.length > 0) {
  console.error(`Error: missing environment variables: ${missing.join(', ')}`);
  console.error('Copy .env.example to .env and fill in your values.');
  process.exit(1);
}

const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
const app = express();

// Meta sends webhook payloads as JSON.
app.use(express.json());

// ── Webhook verification ─────────────────────────────────────────────────────
// Meta verifies ownership of the webhook URL by sending a GET with a challenge.
// This must respond with the challenge value when hub.verify_token matches
// the token you configured in the Meta App Dashboard.
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log('Webhook verified');
    return res.status(200).send(challenge);
  }
  return res.sendStatus(403);
});

// ── Incoming messages ────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
  // Respond 200 immediately — Meta retries if the webhook doesn't ack within
  // a few seconds, which would cause duplicate processing.
  res.sendStatus(200);

  try {
    const entry = req.body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    if (!value?.messages) return;

    for (const message of value.messages) {
      // WhatsApp voice notes have type "audio". Ignore text, image, etc.
      if (message.type !== 'audio') continue;

      const from = message.from;
      const mediaId = message.audio?.id;
      if (!mediaId) continue;

      console.log(`Voice message from ${from} (media: ${mediaId})`);

      try {
        const audioBuffer = await downloadWhatsAppMedia(mediaId);
        const transcript = await transcribeAudio(audioBuffer);

        if (!transcript) {
          await sendWhatsAppMessage(from, 'No speech detected in your voice message.');
          continue;
        }

        // WhatsApp messages cap at 4096 characters — truncate if needed.
        const reply = transcript.length > 4000
          ? transcript.substring(0, 4000) + '...'
          : transcript;

        await sendWhatsAppMessage(from, `Transcript:\n\n${reply}`);
        console.log(`Transcript sent to ${from} (${transcript.length} chars)`);
      } catch (err) {
        console.error(`Failed to process voice message from ${from}:`, err.message);
        await sendWhatsAppMessage(
          from,
          'Sorry, I could not transcribe that voice message. Please try again.'
        ).catch(() => {});
      }
    }
  } catch (err) {
    console.error('Webhook processing error:', err.message);
  }
});

// ── Download media from WhatsApp ─────────────────────────────────────────────
// Two-step process: first get the media URL from the media ID, then download
// the actual file. Both requests need the WhatsApp token for auth.
async function downloadWhatsAppMedia(mediaId) {
  // Step 1: Retrieve the download URL from Meta's Graph API.
  const mediaInfo = await graphApiGet(
    `https://graph.facebook.com/v21.0/${mediaId}`,
    process.env.WHATSAPP_TOKEN
  );
  const mediaUrl = JSON.parse(mediaInfo).url;

  if (!mediaUrl) {
    throw new Error('No download URL in media info response');
  }

  // Step 2: Download the actual audio bytes.
  // Meta's CDN URL is short-lived (~5 minutes) — download immediately.
  return downloadBuffer(mediaUrl, process.env.WHATSAPP_TOKEN);
}

function graphApiGet(url, token) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { Authorization: `Bearer ${token}` },
    };
    https.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return graphApiGet(res.headers.location, token).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => reject(new Error(
          `HTTP ${res.statusCode} from Graph API: ${Buffer.concat(chunks).toString()}`
        )));
        return;
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString()));
      res.on('error', reject);
    }).on('error', reject);
  });
}

function downloadBuffer(url, token) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: { Authorization: `Bearer ${token}` },
    };
    https.get(options, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBuffer(res.headers.location, token).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} downloading media`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

// ── Transcribe with Deepgram ─────────────────────────────────────────────────
async function transcribeAudio(buffer) {
  // SDK v5: transcribeFile() accepts a Buffer directly with flat options.
  // WhatsApp voice notes are Opus-encoded in an OGG container — Deepgram
  // auto-detects the codec so no explicit encoding param is needed.
  const data = await deepgram.listen.v1.media.transcribeFile(buffer, {
    model: 'nova-3',
    smart_format: true,
    // Detect sentiment on the voice message — useful for customer service bots.
    // Access via: data.results.sentiments.segments
    detect_language: true,
    tag: 'deepgram-examples',
  });

  // data.results.channels[0].alternatives[0].transcript
  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (!transcript || transcript.trim().length === 0) {
    return null;
  }
  return transcript;
}

// ── Send reply via WhatsApp Cloud API ────────────────────────────────────────
function sendWhatsAppMessage(to, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      messaging_product: 'whatsapp',
      to,
      type: 'text',
      text: { body },
    });

    const options = {
      hostname: 'graph.facebook.com',
      path: `/v21.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(Buffer.concat(chunks).toString());
        } else {
          reject(new Error(
            `WhatsApp send failed (HTTP ${res.statusCode}): ${Buffer.concat(chunks).toString()}`
          ));
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

app.listen(PORT, () => {
  console.log(`WhatsApp voice transcription server running on port ${PORT}`);
  console.log('Configure your Meta webhook URL to point to /webhook on this server.');
});

module.exports = { app, transcribeAudio, sendWhatsAppMessage };
