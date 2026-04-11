'use strict';

const { DeepgramClient } = require('@deepgram/sdk');
const { GraphClient } = require('./graph');

const DEEPGRAM_LIVE_OPTIONS = {
  model: 'nova-3',
  encoding: 'linear16',
  sample_rate: 16000,
  channels: 1,
  smart_format: true,
  interim_results: true,
  utterance_end_ms: 1000,
  tag: 'deepgram-examples',
};

class CallingHandler {
  constructor() {
    this._deepgram = new DeepgramClient({ apiKey: process.env.DEEPGRAM_API_KEY });
    this._graphClient = null;
    this._activeStreams = new Map();
    this._transcriptCallback = null;
  }

  _getGraphClient() {
    if (!this._graphClient) {
      this._graphClient = new GraphClient();
    }
    return this._graphClient;
  }

  onTranscript(callback) {
    this._transcriptCallback = callback;
  }

  async handleCallback(payload) {
    const notifications = Array.isArray(payload) ? payload : [payload];

    for (const notification of notifications) {
      const resourceData = notification.resourceData || notification;
      const state = resourceData.state || resourceData['@odata.type'];
      const callId = this._extractCallId(notification);

      if (!callId) continue;

      console.log(`[calling] Callback — call: ${callId}, state: ${state}`);

      switch (state) {
        case 'established':
          await this._onCallEstablished(callId);
          break;
        case 'terminated':
          this._onCallTerminated(callId);
          break;
        default:
          break;
      }
    }
  }

  async handleNotification(payload) {
    const notifications = Array.isArray(payload) ? payload : [payload];

    for (const notification of notifications) {
      const callId = this._extractCallId(notification);
      if (!callId) continue;

      if (notification.audioBuffer || notification.data) {
        const audioData = notification.audioBuffer || notification.data;
        const buffer = Buffer.isBuffer(audioData)
          ? audioData
          : Buffer.from(audioData, 'base64');
        this._forwardAudioToDeepgram(callId, buffer);
      }
    }
  }

  async _onCallEstablished(callId) {
    console.log(`[calling] Call ${callId} established — starting Deepgram stream`);

    const dgConnection = await this._deepgram.listen.v1.connect(DEEPGRAM_LIVE_OPTIONS);

    dgConnection.on('open', () => {
      console.log(`[deepgram] Connection opened for call ${callId}`);
    });

    dgConnection.on('error', (err) => {
      console.error(`[deepgram] Error for call ${callId}:`, err.message);
    });

    dgConnection.on('close', () => {
      console.log(`[deepgram] Connection closed for call ${callId}`);
      this._activeStreams.delete(callId);
    });

    dgConnection.on('message', (data) => {
      const transcript = data?.channel?.alternatives?.[0]?.transcript;
      if (transcript) {
        const isFinal = data.is_final;
        const tag = isFinal ? 'final' : 'interim';
        console.log(`[${tag}] ${transcript}`);

        if (isFinal && this._transcriptCallback) {
          this._transcriptCallback(callId, transcript);
        }
      }
    });

    dgConnection.connect();
    await dgConnection.waitForOpen();

    this._activeStreams.set(callId, { dgConnection, bytesSent: 0 });

    try {
      await this._getGraphClient().subscribeToAudio(callId);
    } catch (err) {
      console.error(`[calling] Audio subscription failed for ${callId}:`, err.message);
    }
  }

  _onCallTerminated(callId) {
    console.log(`[calling] Call ${callId} terminated`);
    const stream = this._activeStreams.get(callId);
    if (stream?.dgConnection) {
      try { stream.dgConnection.sendCloseStream({ type: 'CloseStream' }); } catch {}
      try { stream.dgConnection.close(); } catch {}
    }
    this._activeStreams.delete(callId);
  }

  _forwardAudioToDeepgram(callId, audioBuffer) {
    const stream = this._activeStreams.get(callId);
    if (!stream?.dgConnection) return;

    try {
      stream.dgConnection.sendMedia(audioBuffer);
      stream.bytesSent += audioBuffer.length;
    } catch (err) {
      console.error(`[calling] Error forwarding audio for ${callId}:`, err.message);
    }
  }

  _extractCallId(notification) {
    if (notification.resourceUrl) {
      const match = notification.resourceUrl.match(/calls\/([^/]+)/);
      if (match) return match[1];
    }
    if (notification.resource) {
      const match = notification.resource.match(/calls\/([^/]+)/);
      if (match) return match[1];
    }
    return notification.callId || notification.id || null;
  }

  getActiveStreams() {
    return this._activeStreams;
  }

  getDeepgramClient() {
    return this._deepgram;
  }
}

module.exports = { CallingHandler, DEEPGRAM_LIVE_OPTIONS };
