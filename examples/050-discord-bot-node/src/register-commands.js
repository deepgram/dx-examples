'use strict';

// Run this once to register the /transcribe slash command with Discord.
// You only need to re-run it if you change the command definition.
//
//   node src/register-commands.js
//
// Discord caches slash commands globally for up to an hour. If you need
// instant updates during development, register to a specific guild instead
// (see comment below).

require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const commands = [
  new SlashCommandBuilder()
    .setName('transcribe')
    .setDescription('Transcribe an audio file attachment using Deepgram')
    .addAttachmentOption(option =>
      option
        .setName('audio')
        .setDescription('Audio file to transcribe (MP3, WAV, M4A, FLAC, OGG, WebM)')
        .setRequired(true)
    ),
];

async function main() {
  if (!process.env.DISCORD_BOT_TOKEN || !process.env.DISCORD_CLIENT_ID) {
    console.error('Error: DISCORD_BOT_TOKEN and DISCORD_CLIENT_ID must be set.');
    console.error('Copy .env.example to .env and fill in your values.');
    process.exit(1);
  }

  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_BOT_TOKEN);

  console.log('Registering slash commands...');

  // Global commands — available in all servers the bot is added to.
  // Takes up to 1 hour to propagate. For instant dev updates, use:
  //   Routes.applicationGuildCommands(clientId, guildId)
  await rest.put(
    Routes.applicationCommands(process.env.DISCORD_CLIENT_ID),
    { body: commands.map(c => c.toJSON()) },
  );

  console.log('✓ Slash commands registered globally');
}

main().catch(err => {
  console.error('Error registering commands:', err.message);
  process.exit(1);
});
