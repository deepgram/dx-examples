# Microsoft Teams Real-Time Transcription Bot

A Node.js bot that joins Microsoft Teams meetings via the BotFramework SDK and Graph Communications Calling API, streams meeting audio to Deepgram's live speech-to-text API, and posts real-time transcription captions back into the meeting chat.

## What you'll build

An Express server that acts as a Teams bot: it receives messages through the Bot Framework messaging endpoint, joins meetings through the Graph Communications Calling API, captures meeting audio as linear16 PCM, streams it to Deepgram for real-time transcription, and posts final transcripts back into the meeting chat.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- Microsoft Azure account — [sign up](https://portal.azure.com/)
- An Azure Bot Service registration with Teams channel enabled
- Azure AD app registration with `Calls.JoinGroupCall.All` and `Calls.AccessMedia.All` application permissions
- A public HTTPS endpoint (use [ngrok](https://ngrok.com/) or [dev tunnels](https://learn.microsoft.com/en-us/azure/developer/dev-tunnels/) for local development)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `MICROSOFT_APP_ID` | [Azure portal](https://portal.azure.com/) → App registrations → Overview → Application (client) ID |
| `MICROSOFT_APP_PASSWORD` | Azure portal → App registrations → Certificates & secrets → Client secret value |
| `MICROSOFT_APP_TENANT_ID` | Azure portal → App registrations → Overview → Directory (tenant) ID |
| `BOT_BASE_URL` | Your public HTTPS URL (e.g. `https://your-bot.example.com`) |

Copy `.env.example` to `.env` and fill in your values.

## Install and run

```bash
pnpm install
pnpm start
```

Then expose the server publicly (for local dev):

```bash
ngrok http 3978
```

Configure your Azure Bot Service:
1. Set the messaging endpoint to `https://<your-url>/api/messages`
2. Set the calling webhook to `https://<your-url>/api/calling/callback`
3. Enable the Microsoft Teams channel

In a Teams meeting chat, mention the bot and say **join** to start transcription.

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | Deepgram's latest and most accurate STT model |
| `encoding` | `linear16` | 16-bit signed PCM — matches Graph Communications audio format |
| `sample_rate` | `16000` | 16 kHz — standard for Teams meeting audio |
| `smart_format` | `true` | Adds punctuation and formatting to transcripts |
| `interim_results` | `true` | Provides partial transcripts while speech is ongoing |
| `utterance_end_ms` | `1000` | Detects end of speech after 1 second of silence |
| `tag` | `deepgram-examples` | Tags traffic in Deepgram console for identification |

## How it works

1. A user mentions the bot in a Teams meeting chat and sends **join**
2. The bot calls the Graph Communications API to join the meeting as a participant with app-hosted media
3. Graph streams meeting audio as linear16 PCM to the bot's notification endpoint
4. The bot forwards each audio chunk to a Deepgram live WebSocket connection
5. Deepgram returns interim and final transcripts in real-time
6. Final transcripts are posted back to the meeting chat via the Bot Framework messaging API
7. When the user sends **leave**, the bot hangs up the call and closes the Deepgram connection

## Azure AD permissions required

| Permission | Type | Description |
|-----------|------|-------------|
| `Calls.JoinGroupCall.All` | Application | Join group calls and meetings |
| `Calls.AccessMedia.All` | Application | Access media streams in calls |

These must be granted as **application permissions** (not delegated) and require admin consent.

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
