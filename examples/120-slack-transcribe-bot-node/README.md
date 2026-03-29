# Slack Bot — Auto-Transcribe Audio Messages with Deepgram

A Slack bot that automatically transcribes audio and video file attachments using Deepgram nova-3. Drop an audio file into any channel the bot is in and get a transcript back in-thread — no slash commands needed.

## What you'll build

A Node.js Slack bot using Socket Mode that listens for messages containing audio files (MP3, WAV, M4A, voice clips, screen recordings, etc.). When it detects one, it downloads the file from Slack, sends it to Deepgram's pre-recorded speech-to-text API, and replies in the message thread with the formatted transcript. Long transcripts are chunked into readable blocks.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- Slack workspace where you can install apps — [create a Slack app](https://api.slack.com/apps)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `SLACK_BOT_TOKEN` | [Slack app dashboard](https://api.slack.com/apps) → your app → OAuth & Permissions → Bot User OAuth Token (starts with `xoxb-`) |
| `SLACK_APP_TOKEN` | [Slack app dashboard](https://api.slack.com/apps) → your app → Basic Information → App-Level Tokens (starts with `xapp-`, needs `connections:write` scope) |

Copy `.env.example` to `.env` and fill in your values.

## Slack app setup

1. Go to [api.slack.com/apps](https://api.slack.com/apps) and create a new app **From scratch**
2. Under **Socket Mode**, enable it and create an app-level token with `connections:write` scope — copy this as `SLACK_APP_TOKEN`
3. Under **Event Subscriptions**, enable events and subscribe to these bot events:
   - `message.channels`
   - `message.groups`
   - `message.im`
   - `message.mpim`
4. Under **OAuth & Permissions**, add these Bot Token Scopes:
   - `channels:history` — read messages in public channels
   - `groups:history` — read messages in private channels
   - `im:history` — read direct messages
   - `mpim:history` — read group DMs
   - `files:read` — download file attachments
   - `chat:write` — post transcript replies
5. Install the app to your workspace and copy the Bot User OAuth Token as `SLACK_BOT_TOKEN`
6. Invite the bot to a channel: `/invite @YourBotName`

## Install and run

```bash
npm install
npm start
```

Then post an audio file in a channel the bot has been invited to. The bot will reply in-thread with the transcript.

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | General-purpose STT model. Use `nova-3-phonecall` for phone recordings |
| `smart_format` | `true` | Adds punctuation, capitalisation, and number formatting |
| `paragraphs` | `true` | Detects paragraph boundaries for longer recordings |

## How it works

1. The bot connects to Slack via Socket Mode (WebSocket — no public URL needed)
2. When a message arrives with file attachments, the bot filters for audio/video files
3. It downloads each file from Slack using the bot token for authentication
4. The audio buffer is sent to Deepgram's `transcribeFile()` pre-recorded API
5. The transcript is posted as a threaded reply, chunked into readable blocks if long

## Related

- [Deepgram pre-recorded STT docs](https://developers.deepgram.com/docs/pre-recorded-audio)
- [Deepgram Node.js SDK](https://github.com/deepgram/deepgram-js-sdk)
- [Slack Bolt for JavaScript](https://slack.dev/bolt-js/)
- [Slack API — Events](https://api.slack.com/events)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
