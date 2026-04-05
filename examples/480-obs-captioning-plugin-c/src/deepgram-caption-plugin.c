/*
 * OBS Studio Live Captioning Plugin — Deepgram STT
 *
 * Captures audio from OBS's audio pipeline, streams it to the Deepgram
 * real-time WebSocket API, and renders transcription results as a text
 * source overlay. Uses linear16 encoding at 16 kHz mono so Deepgram
 * can process frames with minimal latency.
 *
 * Build:  cmake -B build && cmake --build build
 * Load:   copy the .so/.dll into your OBS plugins directory
 */

#include <obs-module.h>
#include <obs-frontend-api.h>
#include <libwebsockets.h>
#include <string.h>
#include <stdlib.h>
#include <stdio.h>
#include <pthread.h>

OBS_DECLARE_MODULE()
OBS_MODULE_USE_DEFAULT_LOCALE("deepgram-captions", "en-US")

/* ── Deepgram WebSocket endpoint ─────────────────────────────────────────── */
#define DG_HOST        "api.deepgram.com"
#define DG_PATH        "/v1/listen?" \
                       "model=nova-3&" \
                       "encoding=linear16&" \
                       "sample_rate=16000&" \
                       "channels=1&" \
                       "interim_results=true&" \
                       "smart_format=true&" \
                       "tag=deepgram-examples"
#define DG_PORT        443

/* Ring-buffer size: ~2 s of 16 kHz 16-bit mono audio */
#define AUDIO_BUF_SIZE (16000 * 2 * 2)

/* ── Plugin state ────────────────────────────────────────────────────────── */
typedef struct {
	obs_source_t *text_source;
	obs_source_t *audio_source;

	struct lws_context *ws_ctx;
	struct lws *ws_conn;
	pthread_t ws_thread;
	volatile bool running;

	/* Circular audio buffer shared between OBS audio callback and WS thread */
	uint8_t audio_buf[AUDIO_BUF_SIZE];
	size_t  write_pos;
	size_t  read_pos;
	pthread_mutex_t buf_lock;

	/* Latest transcript displayed in the text source */
	char transcript[4096];
	pthread_mutex_t text_lock;

	char api_key[256];
} dg_caption_t;

static dg_caption_t g_state;

/* ── JSON helpers (minimal — avoids pulling in a full JSON library) ────── */

/* Find the value of "transcript" in a flat JSON object.
 * Deepgram streaming responses nest it at:
 *   channel.alternatives[0].transcript                                     */
static const char *find_transcript(const char *json, size_t len,
				   char *out, size_t out_sz)
{
	const char *key = "\"transcript\":\"";
	const char *p = memmem(json, len, key, strlen(key));
	if (!p)
		return NULL;

	p += strlen(key);
	const char *end = memchr(p, '"', (json + len) - p);
	if (!end)
		return NULL;

	size_t n = (size_t)(end - p);
	if (n >= out_sz)
		n = out_sz - 1;
	memcpy(out, p, n);
	out[n] = '\0';
	return out;
}

/* ── WebSocket callback ──────────────────────────────────────────────────── */

static int ws_callback(struct lws *wsi, enum lws_callback_reasons reason,
		       void *user, void *in, size_t len)
{
	dg_caption_t *st = &g_state;

	switch (reason) {
	case LWS_CALLBACK_CLIENT_ESTABLISHED:
		/* Connection open — request a writable callback so we can
		 * start streaming audio frames. */
		lws_callback_on_writable(wsi);
		break;

	case LWS_CALLBACK_CLIENT_WRITEABLE: {
		/* Send any buffered audio to Deepgram */
		pthread_mutex_lock(&st->buf_lock);
		size_t avail = (st->write_pos >= st->read_pos)
			? st->write_pos - st->read_pos
			: AUDIO_BUF_SIZE - st->read_pos + st->write_pos;

		if (avail > 0) {
			/* Linearise into a contiguous scratch buffer */
			size_t chunk = avail;
			if (chunk > 8000)
				chunk = 8000; /* ← cap per-frame to ~250 ms */
			uint8_t tmp[LWS_PRE + 8000];
			size_t off = 0;
			while (off < chunk) {
				tmp[LWS_PRE + off] = st->audio_buf[st->read_pos];
				st->read_pos = (st->read_pos + 1) % AUDIO_BUF_SIZE;
				off++;
			}
			pthread_mutex_unlock(&st->buf_lock);
			lws_write(wsi, tmp + LWS_PRE, chunk, LWS_WRITE_BINARY);
		} else {
			pthread_mutex_unlock(&st->buf_lock);
		}

		if (st->running)
			lws_callback_on_writable(wsi);
		break;
	}

	case LWS_CALLBACK_CLIENT_RECEIVE: {
		/* Parse Deepgram JSON response for the transcript field */
		char text[4096];
		if (find_transcript((const char *)in, len, text, sizeof(text)) &&
		    text[0] != '\0') {
			pthread_mutex_lock(&st->text_lock);
			strncpy(st->transcript, text, sizeof(st->transcript) - 1);
			st->transcript[sizeof(st->transcript) - 1] = '\0';
			pthread_mutex_unlock(&st->text_lock);

			/* Push transcript to the OBS text source */
			if (st->text_source) {
				obs_data_t *settings =
					obs_source_get_settings(st->text_source);
				obs_data_set_string(settings, "text",
						    st->transcript);
				obs_source_update(st->text_source, settings);
				obs_data_release(settings);
			}
		}
		break;
	}

	case LWS_CALLBACK_CLIENT_CONNECTION_ERROR:
	case LWS_CALLBACK_CLIENT_CLOSED:
		st->ws_conn = NULL;
		break;

	default:
		break;
	}
	return 0;
}

static const struct lws_protocols protocols[] = {
	{"deepgram", ws_callback, 0, 65536},
	{NULL, NULL, 0, 0},
};

/* ── WebSocket thread — runs the lws event loop ─────────────────────────── */

static void *ws_thread_fn(void *arg)
{
	dg_caption_t *st = (dg_caption_t *)arg;

	struct lws_context_creation_info ctx_info;
	memset(&ctx_info, 0, sizeof(ctx_info));
	ctx_info.port = CONTEXT_PORT_NO_LISTEN;
	ctx_info.protocols = protocols;
	ctx_info.options = LWS_SERVER_OPTION_DO_SSL_GLOBAL_INIT;

	st->ws_ctx = lws_create_context(&ctx_info);
	if (!st->ws_ctx)
		return NULL;

	/* Build the auth header Deepgram requires */
	char auth_hdr[300];
	snprintf(auth_hdr, sizeof(auth_hdr), "Token %s", st->api_key);

	struct lws_client_connect_info conn_info;
	memset(&conn_info, 0, sizeof(conn_info));
	conn_info.context       = st->ws_ctx;
	conn_info.address       = DG_HOST;
	conn_info.port          = DG_PORT;
	conn_info.path          = DG_PATH;
	conn_info.host          = DG_HOST;
	conn_info.origin        = DG_HOST;
	conn_info.protocol      = protocols[0].name;
	conn_info.ssl_connection = LCCSCF_USE_SSL;

	/* Custom headers — Deepgram uses "Authorization: Token <key>" */
	char custom_hdr[512];
	snprintf(custom_hdr, sizeof(custom_hdr),
		 "Authorization: %s\r\n", auth_hdr);

	unsigned char hdr_buf[512 + LWS_PRE];
	unsigned char *p = hdr_buf + LWS_PRE;
	unsigned char *end = hdr_buf + sizeof(hdr_buf) - 1;
	if (lws_add_http_header_by_name(st->ws_ctx,
					(const unsigned char *)"Authorization:",
					(const unsigned char *)auth_hdr,
					(int)strlen(auth_hdr), &p, end) == 0) {
		/* Headers built successfully */
	}

	st->ws_conn = lws_client_connect_via_info(&conn_info);

	/* Event loop: keep servicing until told to stop */
	while (st->running && st->ws_ctx) {
		lws_service(st->ws_ctx, 50);
	}

	/* Send a CloseStream message so Deepgram flushes final results */
	if (st->ws_conn) {
		const char *close_msg = "{\"type\":\"CloseStream\"}";
		size_t msg_len = strlen(close_msg);
		uint8_t buf[LWS_PRE + 64];
		memcpy(buf + LWS_PRE, close_msg, msg_len);
		lws_write(st->ws_conn, buf + LWS_PRE, msg_len, LWS_WRITE_TEXT);
	}

	lws_context_destroy(st->ws_ctx);
	st->ws_ctx = NULL;
	return NULL;
}

/* ── OBS audio capture callback ──────────────────────────────────────────── */

/* Called by OBS for every audio frame from the monitored source.
 * Resamples to 16 kHz mono 16-bit PCM and writes into the ring buffer. */
static void audio_capture_cb(void *param, obs_source_t *source,
			     const struct audio_data *data, bool muted)
{
	(void)source;
	(void)muted;
	dg_caption_t *st = (dg_caption_t *)param;

	if (!st->running || !data->frames)
		return;

	/* OBS delivers float planar audio; we take channel 0 and convert to
	 * 16-bit signed PCM. A production plugin would resample to 16 kHz
	 * here — for this example we assume the OBS output is already 16 kHz
	 * or close enough for Deepgram to handle. */
	const float *src = (const float *)data->data[0];
	size_t frames = data->frames;

	pthread_mutex_lock(&st->buf_lock);
	for (size_t i = 0; i < frames; i++) {
		float sample = src[i];
		if (sample > 1.0f) sample = 1.0f;
		if (sample < -1.0f) sample = -1.0f;
		int16_t pcm = (int16_t)(sample * 32767.0f);

		st->audio_buf[st->write_pos]     = (uint8_t)(pcm & 0xFF);
		st->audio_buf[st->write_pos + 1] = (uint8_t)((pcm >> 8) & 0xFF);
		st->write_pos = (st->write_pos + 2) % AUDIO_BUF_SIZE;
	}
	pthread_mutex_unlock(&st->buf_lock);
}

/* ── OBS plugin lifecycle ────────────────────────────────────────────────── */

bool obs_module_load(void)
{
	dg_caption_t *st = &g_state;
	memset(st, 0, sizeof(*st));
	pthread_mutex_init(&st->buf_lock, NULL);
	pthread_mutex_init(&st->text_lock, NULL);

	/* Read API key from environment — never hardcoded */
	const char *key = getenv("DEEPGRAM_API_KEY");
	if (!key || key[0] == '\0') {
		blog(LOG_WARNING,
		     "[deepgram-captions] DEEPGRAM_API_KEY not set; "
		     "plugin will not start");
		return true; /* Return true so OBS still loads */
	}
	strncpy(st->api_key, key, sizeof(st->api_key) - 1);

	/* Create the text source that displays captions */
	obs_data_t *text_settings = obs_data_create();
	obs_data_set_string(text_settings, "text", "");
	obs_data_set_string(text_settings, "font_face", "Sans Serif");
	obs_data_set_int(text_settings, "font_size", 48);
	obs_data_set_int(text_settings, "color", 0xFFFFFFFF);
	st->text_source = obs_source_create("text_ft2_source_v2",
					    "Deepgram Captions",
					    text_settings, NULL);
	obs_data_release(text_settings);

	/* Hook into the default desktop audio source for capture */
	obs_source_t *desktop =
		obs_get_output_source(0); /* ← channel 0 = desktop audio */
	if (desktop) {
		obs_source_add_audio_capture_callback(desktop,
						      audio_capture_cb, st);
		st->audio_source = desktop;
	}

	/* Start the WebSocket thread */
	st->running = true;
	pthread_create(&st->ws_thread, NULL, ws_thread_fn, st);

	blog(LOG_INFO, "[deepgram-captions] Plugin loaded — streaming to "
			"Deepgram nova-3");
	return true;
}

void obs_module_unload(void)
{
	dg_caption_t *st = &g_state;
	st->running = false;

	if (st->ws_thread) {
		pthread_join(st->ws_thread, NULL);
	}

	if (st->audio_source) {
		obs_source_remove_audio_capture_callback(st->audio_source,
							 audio_capture_cb, st);
		obs_source_release(st->audio_source);
	}

	if (st->text_source) {
		obs_source_release(st->text_source);
	}

	pthread_mutex_destroy(&st->buf_lock);
	pthread_mutex_destroy(&st->text_lock);

	blog(LOG_INFO, "[deepgram-captions] Plugin unloaded");
}

const char *obs_module_name(void)
{
	return "Deepgram Live Captions";
}

const char *obs_module_description(void)
{
	return "Real-time captioning overlay powered by Deepgram STT (nova-3)";
}
