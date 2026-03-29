# Discord Bot — Transcribe Audio Attachments with Deepgram

A Discord bot with a `/transcribe` slash command that converts audio file attachments to text using Deepgram nova-3. Users attach an audio file in any text channel, run the command, and get the transcript back instantly.

## What you'll build

A Node.js Discord bot that listens for the `/transcribe` slash command. When a user attaches an audio file (MP3, WAV, FLAC, M4A, OGG, WebM, or MP4), the bot downloads it, sends it to Deepgram's pre-recorded speech-to-text API, and replies with the formatted transcript. Long transcripts are automatically sent as a `.txt` file attachment to avoid Discord's 2000-character message limit.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- Discord account with a registered application and bot — [create one](https://discord.com/developers/applications)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `DISCORD_BOT_TOKEN` | [Discord Developer Portal](https://discord.com/developers/applications) → your app → Bot → Token |
| `DISCORD_CLIENT_ID` | [Discord Developer Portal](https://discord.com/developers/applications) → your app → General Information → Application ID |

Copy `.env.example` to `.env` and fill in your values.

## Discord bot setup

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications) and create a new application
2. Under **Bot**, click "Reset Token" and copy it to `DISCORD_BOT_TOKEN`
3. Under **OAuth2 → URL Generator**, select scopes `bot` and `applications.commands`, then permissions `Send Messages` and `Attach Files`
4. Open the generated URL to invite the bot to your server

## Install and run

```bash
npm install

# Register the /transcribe slash command (run once)
npm run register

# Start the bot
npm start
```

## How it works

1. The bot connects to Discord with the `Guilds` gateway intent (minimal permissions)
2. When a user runs `/transcribe` with an audio attachment, the bot defers the reply (transcription takes a few seconds)
3. The bot downloads the attachment from Discord's CDN into a buffer
4. The buffer is sent to Deepgram's `transcribeFile()` API with nova-3 and smart formatting
5. The transcript is posted back as a message, or as a `.txt` file if it exceeds Discord's character limit

## Related

- [Deepgram pre-recorded STT docs](https://developers.deepgram.com/docs/pre-recorded-audio)
- [Deepgram Node.js SDK](https://github.com/deepgram/deepgram-js-sdk)
- [Discord.js guide](https://discordjs.guide/)
- [Discord Developer Portal](https://discord.com/developers/applications)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
