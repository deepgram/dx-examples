# Cloudflare Worker — Edge Audio Transcription

Transcribe audio at the edge with a Cloudflare Worker and Deepgram nova-3. Accept audio file uploads or public URLs and return transcripts in JSON — deployed to 300+ locations worldwide with zero cold starts.

## What you'll build

A Cloudflare Worker with two endpoints: `POST /transcribe-url` accepts a JSON body with a public audio URL (Deepgram fetches it server-side), and `POST /transcribe` accepts raw audio bytes streamed directly to Deepgram without buffering. Both return a JSON response with transcript, confidence, duration, and word count.

## Prerequisites

- Node.js 18+
- Cloudflare account — [sign up free](https://dash.cloudflare.com/sign-up)
- Wrangler CLI (`npm install -g wrangler`)
- Deepgram account — [get a free API key](https://console.deepgram.com/)

## Environment variables

| Variable | Where to find it |
|----------|-----------------|
| `DEEPGRAM_API_KEY` | [Deepgram console](https://console.deepgram.com/) |

For local development, create `.dev.vars` with your API key:

```
DEEPGRAM_API_KEY=your_key_here
```

For production, set the secret via Wrangler:

```bash
wrangler secret put DEEPGRAM_API_KEY
```

## Install and run

```bash
npm install

# Local development
wrangler dev

# Deploy to Cloudflare
wrangler deploy
```

Then try it:

```bash
# Transcribe from a URL
curl -X POST http://localhost:8787/transcribe-url \
  -H "Content-Type: application/json" \
  -d '{"url": "https://dpgr.am/spacewalk.wav"}'

# Upload raw audio
curl -X POST http://localhost:8787/transcribe \
  -H "Content-Type: audio/wav" \
  --data-binary @recording.wav
```

## How it works

1. The Worker uses Deepgram's REST API directly (`POST https://api.deepgram.com/v1/listen`) instead of the SDK — Workers have a constrained runtime without Node.js built-ins, and the REST API is a single HTTP call
2. For URL transcription, Deepgram fetches the audio server-side — the bytes never pass through the Worker, keeping CPU time minimal
3. For file uploads, the Worker streams the request body directly to Deepgram using `request.body` (a `ReadableStream`) — no buffering the entire file in memory
4. Secrets are accessed via the `env` parameter (not `process.env`) and set with `wrangler secret put`
5. Authentication uses `Token` scheme (not `Bearer`) — this is Deepgram-specific

## Why a Worker instead of a traditional server?

- **Zero cold starts** — Workers are always warm, unlike Lambda or Cloud Functions
- **Global edge deployment** — runs in 300+ locations, so the closest Deepgram region is always nearby
- **No infrastructure** — no servers, containers, or scaling configuration
- **Cost-effective** — 100,000 free requests/day on the Workers free plan
- **Streaming** — Workers natively support streaming request/response bodies

## Related

- [Deepgram pre-recorded STT docs](https://developers.deepgram.com/docs/pre-recorded-audio)
- [Deepgram REST API reference](https://developers.deepgram.com/reference/listen-file)
- [Cloudflare Workers docs](https://developers.cloudflare.com/workers/)
- [Wrangler CLI reference](https://developers.cloudflare.com/workers/wrangler/)

## Starter templates

If you want a ready-to-run base for your own project, check the [deepgram-starters](https://github.com/orgs/deepgram-starters/repositories) org — there are starter repos for every language and every Deepgram product.
