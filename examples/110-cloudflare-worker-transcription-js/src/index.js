/**
 * Cloudflare Worker that transcribes audio using Deepgram nova-3.
 *
 * Supports two modes:
 *   POST /transcribe-url  — JSON body with { url } (Deepgram fetches the audio)
 *   POST /transcribe      — raw audio in the request body (streamed to Deepgram)
 *
 * Deploy:
 *   wrangler secret put DEEPGRAM_API_KEY
 *   wrangler deploy
 *
 * Test locally:
 *   wrangler dev
 *   curl -X POST http://localhost:8787/transcribe-url \
 *     -H "Content-Type: application/json" \
 *     -d '{"url": "https://dpgr.am/spacewalk.wav"}'
 */

// Deepgram's pre-recorded transcription REST endpoint.
// We use the REST API directly instead of the SDK because Cloudflare Workers
// have a constrained runtime — the SDK pulls in Node.js-specific dependencies
// (http, stream, buffer) that don't exist in the Workers environment.
// The REST API is a single POST request, so there's no benefit to the SDK here.
const DG_API_BASE = 'https://api.deepgram.com/v1/listen';

// nova-3 is the 2025 flagship model. smart_format adds punctuation and
// number/date formatting (~10 ms overhead). These are query parameters
// on the REST endpoint, not JSON body fields.
const DEFAULT_PARAMS = {
  model: 'nova-3',
  smart_format: 'true',
};

export default {
  async fetch(request, env) {
    // Workers access secrets via the `env` parameter — not process.env.
    // Set with: wrangler secret put DEEPGRAM_API_KEY
    if (!env.DEEPGRAM_API_KEY) {
      return jsonResponse(500, {
        error: 'DEEPGRAM_API_KEY secret not configured. Run: wrangler secret put DEEPGRAM_API_KEY',
      });
    }

    const url = new URL(request.url);

    if (request.method === 'GET' && url.pathname === '/health') {
      return jsonResponse(200, { status: 'ok' });
    }

    if (request.method !== 'POST') {
      return jsonResponse(405, { error: 'Method not allowed. Use POST.' });
    }

    if (url.pathname === '/transcribe-url') {
      return handleTranscribeUrl(request, env);
    }

    if (url.pathname === '/transcribe') {
      return handleTranscribeFile(request, env);
    }

    return jsonResponse(404, { error: `Unknown path: ${url.pathname}` });
  },
};

/**
 * Transcribe audio from a public URL.
 * Deepgram fetches the audio server-side — the bytes never pass through
 * the Worker, so this stays well within the CPU time limit.
 */
async function handleTranscribeUrl(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse(400, { error: 'Invalid JSON body. Expected: { "url": "..." }' });
  }

  if (!body.url) {
    return jsonResponse(400, { error: 'Missing "url" field in request body' });
  }

  // Deepgram's REST API accepts the audio source as a JSON body with { url }
  // when you set Content-Type: application/json. Query params configure the model.
  const params = new URLSearchParams({ ...DEFAULT_PARAMS, ...parseOptions(body) });
  const dgUrl = `${DG_API_BASE}?${params}`;

  const dgResponse = await fetch(dgUrl, {
    method: 'POST',
    headers: {
      // Deepgram uses "Token" scheme, not "Bearer". This is a common gotcha —
      // using "Bearer" returns 401 with an unhelpful error message.
      Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ url: body.url }),
  });

  return formatDgResponse(dgResponse);
}

/**
 * Transcribe audio uploaded in the request body.
 * The Worker streams the request body directly to Deepgram — no buffering
 * the entire file in memory. This keeps memory usage flat regardless of
 * file size (important since Workers have a 128 MB limit).
 */
async function handleTranscribeFile(request, env) {
  const contentType = request.headers.get('content-type') || 'audio/wav';

  // For raw audio uploads, the audio bytes ARE the request body and
  // Content-Type tells Deepgram the format (audio/wav, audio/mp3, etc.).
  const params = new URLSearchParams(DEFAULT_PARAMS);
  const dgUrl = `${DG_API_BASE}?${params}`;

  const dgResponse = await fetch(dgUrl, {
    method: 'POST',
    headers: {
      Authorization: `Token ${env.DEEPGRAM_API_KEY}`,
      'Content-Type': contentType,
    },
    // Stream the request body directly to Deepgram without buffering.
    // Cloudflare Workers support ReadableStream bodies natively.
    body: request.body,
  });

  return formatDgResponse(dgResponse);
}

function parseOptions(body) {
  const opts = {};
  if (body.model) opts.model = body.model;
  if (body.language) opts.language = body.language;
  if (body.smart_format !== undefined) opts.smart_format = String(body.smart_format);
  if (body.diarize) opts.diarize = 'true';
  return opts;
}

async function formatDgResponse(dgResponse) {
  if (!dgResponse.ok) {
    // Deepgram returns JSON error bodies with a `reason` field.
    // 401 = bad key, 402 = quota exceeded, 400 = bad audio format.
    const errorBody = await dgResponse.text();
    return jsonResponse(dgResponse.status, {
      error: `Deepgram API error (${dgResponse.status})`,
      detail: errorBody,
    });
  }

  const data = await dgResponse.json();
  const alt = data?.results?.channels?.[0]?.alternatives?.[0];

  if (!alt) {
    return jsonResponse(500, { error: 'Unexpected response structure from Deepgram' });
  }

  const words = alt.words || [];
  const duration = words.length > 0 ? words[words.length - 1].end : 0;

  return jsonResponse(200, {
    transcript: alt.transcript,
    confidence: alt.confidence,
    duration_seconds: Math.round(duration * 100) / 100,
    words_count: words.length,
  });
}

function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      // Allow cross-origin requests so the Worker can be called from
      // any frontend. In production, restrict this to your domain.
      'Access-Control-Allow-Origin': '*',
    },
  });
}
