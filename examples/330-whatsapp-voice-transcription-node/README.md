# WhatsApp Business — Voice Message Transcription with Deepgram

A Node.js webhook server that receives WhatsApp voice messages via the WhatsApp Business Cloud API, transcribes them with Deepgram nova-3, and replies with the transcript. Ideal for customer service bots, compliance logging, and accessibility tools in WhatsApp-first markets.

## What you'll build

An Express server that acts as a WhatsApp Business webhook. When a user sends a voice note, the server downloads the audio from Meta's CDN, sends it to Deepgram's pre-recorded speech-to-text API, and replies to the sender with the transcript — all within seconds.

## Prerequisites

- Node.js 18+
- Deepgram account — [get a free API key](https://console.deepgram.com/)
- Meta Business account with WhatsApp Business API access — [get started](https://developers.facebook.com/docs/whatsapp/cloud-api/get-started)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |
| `WHATSAPP_TOKEN` | [Meta App Dashboard](https://developers.facebook.com/apps/) → your app → WhatsApp → API Setup → Temporary access token (or a permanent System User token) |
| `WHATSAPP_VERIFY_TOKEN` | A secret string you choose — enter it in both your `.env` and the Meta webhook configuration |
| `WHATSAPP_PHONE_NUMBER_ID` | [Meta App Dashboard](https://developers.facebook.com/apps/) → your app → WhatsApp → API Setup → Phone number ID |

Copy `.env.example` to `.env` and fill in your values.

## Install and run

```bash
npm install
npm start
```

The server starts on port 3000 (override with `PORT` env var). You'll need a public URL for Meta's webhook — use [ngrok](https://ngrok.com/) for local development:

```bash
ngrok http 3000
```

Then configure the webhook in the Meta App Dashboard:
1. Go to your app → WhatsApp → Configuration
2. Set the Callback URL to `https://<your-ngrok-url>/webhook`
3. Set the Verify Token to your `WHATSAPP_VERIFY_TOKEN` value
4. Subscribe to the `messages` webhook field

## Key parameters

| Parameter | Value | Description |
|-----------|-------|-------------|
| `model` | `nova-3` | General-purpose STT model with best accuracy |
| `smart_format` | `true` | Adds punctuation, capitalisation, and number formatting |
| `detect_language` | `true` | Auto-detects the spoken language — useful for international WhatsApp users |

## How it works

1. Meta sends a POST to `/webhook` when a WhatsApp message arrives
2. The server filters for `audio` type messages (voice notes, audio attachments)
3. It retrieves the media download URL from Meta's Graph API using the media ID
4. The audio file is downloaded from Meta's CDN (Opus/OGG format for voice notes)
5. The audio buffer is sent to Deepgram's `transcribeFile()` pre-recorded API
6. The transcript is sent back to the user as a WhatsApp text reply
7. The server responds 200 immediately to avoid Meta's webhook retry logic

## Starter templates

[deepgram-starters](https://github.com/orgs/deepgram-starters/repositories)
