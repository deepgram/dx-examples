'use strict';

// Discord bot that transcribes audio file attachments using Deepgram nova-3.
//
// Users attach an audio file and run /transcribe — the bot downloads it,
// sends it to Deepgram's pre-recorded API, and replies with the transcript.
// No voice channel infrastructure needed — this works entirely with file
// attachments in text channels.

require('dotenv').config();

const { Client, Events, GatewayIntentBits, AttachmentBuilder } = require('discord.js');
const { DeepgramClient } = require('@deepgram/sdk');
const https = require('https');
const http = require('http');

// Deepgram's pre-recorded API accepts audio via URL or buffer. We download
// the Discord attachment and send the buffer because Discord CDN URLs are
// ephemeral — they expire and can't be fetched server-side by Deepgram.
const SUPPORTED_CONTENT_TYPES = new Set([
  'audio/mpeg',       // MP3
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
  'video/mp4',        // MP4 video often contains audio Deepgram can transcribe
  'video/webm',
]);

// Discord attachment file extensions — fallback when content-type is missing
const SUPPORTED_EXTENSIONS = new Set([
  '.mp3', '.wav', '.flac', '.ogg', '.webm', '.m4a', '.aac', '.mp4', '.opus',
]);

function isAudioFile(attachment) {
  if (attachment.contentType && SUPPORTED_CONTENT_TYPES.has(attachment.contentType.split(';')[0])) {
    return true;
  }
  const name = (attachment.name || '').toLowerCase();
  return SUPPORTED_EXTENSIONS.has(name.substring(name.lastIndexOf('.')));
}

function downloadBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    client.get(url, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadBuffer(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} downloading attachment`));
      }
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

async function transcribeAttachment(deepgram, attachment) {
  const buffer = await downloadBuffer(attachment.url);

  // SDK v5: transcribeFile() accepts a Buffer directly. The SDK sends it
  // as the request body with the correct Content-Type header.
  // We use a flat options object — SDK v5 does NOT take two arguments.
  const data = await deepgram.listen.v1.media.transcribeFile(buffer, {
    // nova-3 is the current flagship model (2025).
    // For phone call recordings: 'nova-3-phonecall'
    model: 'nova-3',
    // smart_format adds punctuation, capitalisation, and number formatting.
    // Costs ~10 ms extra but makes transcripts much more readable.
    smart_format: true,
    // Detect paragraphs — useful for longer recordings.
    paragraphs: true,
  });

  const transcript = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript;
  if (!transcript || transcript.trim().length === 0) {
    return null;
  }
  return transcript;
}

async function main() {
  if (!process.env.DEEPGRAM_API_KEY) {
    console.error('Error: DEEPGRAM_API_KEY is not set.');
    process.exit(1);
  }
  if (!process.env.DISCORD_BOT_TOKEN) {
    console.error('Error: DISCORD_BOT_TOKEN is not set.');
    process.exit(1);
  }

  const deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });

  // GatewayIntentBits.Guilds is required for slash commands to work.
  // We do NOT need MessageContent or GuildMessages — slash commands
  // deliver the attachment directly via the interaction payload.
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, readyClient => {
    console.log(`✓ Logged in as ${readyClient.user.tag}`);
    console.log(`  Serving ${readyClient.guilds.cache.size} guild(s)`);
    console.log('  Use /transcribe with an audio file attachment');
  });

  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    if (interaction.commandName !== 'transcribe') return;

    const attachment = interaction.options.getAttachment('audio');

    if (!isAudioFile(attachment)) {
      await interaction.reply({
        content: 'That doesn\'t look like an audio file. Supported formats: MP3, WAV, FLAC, OGG, WebM, M4A, AAC, MP4.',
        ephemeral: true,
      });
      return;
    }

    // 25 MB is a safe limit — Discord's max is 8 MB for free, 50 MB for
    // boosted servers, and 100 MB for Nitro. Deepgram handles up to ~2 GB.
    if (attachment.size > 25 * 1024 * 1024) {
      await interaction.reply({
        content: 'File is too large (>25 MB). Try a shorter recording or compress it first.',
        ephemeral: true,
      });
      return;
    }

    // deferReply() tells Discord we need more than 3 seconds to respond.
    // Without this, Discord shows "This interaction failed" after 3s.
    await interaction.deferReply();

    try {
      const transcript = await transcribeAttachment(deepgram, attachment);

      if (!transcript) {
        await interaction.editReply('No speech detected in that file. Is the audio silent or very short?');
        return;
      }

      // Discord messages are capped at 2000 characters. For longer
      // transcripts, attach a .txt file so nothing gets truncated.
      if (transcript.length > 1800) {
        const txtBuffer = Buffer.from(transcript, 'utf-8');
        const file = new AttachmentBuilder(txtBuffer, { name: 'transcript.txt' });
        await interaction.editReply({
          content: `Transcribed **${attachment.name}** (${transcript.length.toLocaleString()} chars) — full text attached:`,
          files: [file],
        });
      } else {
        await interaction.editReply(
          `**Transcript of ${attachment.name}:**\n\`\`\`\n${transcript}\n\`\`\``
        );
      }
    } catch (err) {
      console.error('Transcription error:', err);
      // Common causes:
      //   401 — bad API key
      //   402 — free tier quota exceeded
      //   400 — unsupported format or corrupted file
      await interaction.editReply('Sorry, something went wrong transcribing that file. Check the bot logs for details.');
    }
  });

  await client.login(process.env.DISCORD_BOT_TOKEN);
}

main().catch(err => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
