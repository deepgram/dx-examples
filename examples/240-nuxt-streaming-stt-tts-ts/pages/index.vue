<script setup lang="ts">
const SAMPLE_RATE = 16000;

const isRecording = ref(false);
const isSpeaking = ref(false);
const transcripts = ref<{ text: string; isFinal: boolean }[]>([]);
const interimText = ref('');
const ttsInput = ref('');
const statusMessage = ref('Click "Start" to begin recording');

let ws: WebSocket | null = null;
let audioContext: AudioContext | null = null;
let mediaStream: MediaStream | null = null;
let scriptNode: ScriptProcessorNode | null = null;

function float32ToInt16(float32: Float32Array): Int16Array {
  const int16 = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return int16;
}

async function startRecording() {
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { sampleRate: SAMPLE_RATE, channelCount: 1, echoCancellation: true },
    });
  } catch {
    statusMessage.value = 'Microphone access denied';
    return;
  }

  audioContext = new AudioContext({ sampleRate: SAMPLE_RATE });
  const source = audioContext.createMediaStreamSource(mediaStream);
  // 4096-sample buffer — balances latency vs. overhead
  scriptNode = audioContext.createScriptProcessor(4096, 1, 1);

  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${location.host}/api/listen`);

  ws.onopen = () => {
    statusMessage.value = 'Listening…';
    isRecording.value = true;
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.error) {
        statusMessage.value = `Error: ${data.error}`;
        return;
      }
      const transcript = data?.channel?.alternatives?.[0]?.transcript;
      if (!transcript) return;

      if (data.is_final) {
        transcripts.value.push({ text: transcript, isFinal: true });
        interimText.value = '';
      } else {
        interimText.value = transcript;
      }
    } catch {}
  };

  ws.onerror = () => {
    statusMessage.value = 'WebSocket error — check server logs';
  };

  ws.onclose = () => {
    if (isRecording.value) {
      statusMessage.value = 'Connection closed';
      isRecording.value = false;
    }
  };

  scriptNode.onaudioprocess = (e) => {
    if (ws?.readyState !== WebSocket.OPEN) return;
    const pcm = float32ToInt16(e.inputBuffer.getChannelData(0));
    ws.send(pcm.buffer);
  };

  source.connect(scriptNode);
  scriptNode.connect(audioContext.destination);
}

function stopRecording() {
  isRecording.value = false;
  statusMessage.value = 'Stopped';

  if (scriptNode) { scriptNode.disconnect(); scriptNode = null; }
  if (audioContext) { audioContext.close(); audioContext = null; }
  if (mediaStream) { mediaStream.getTracks().forEach(t => t.stop()); mediaStream = null; }
  if (ws) { ws.close(); ws = null; }
}

async function speakText() {
  if (!ttsInput.value.trim() || isSpeaking.value) return;
  isSpeaking.value = true;

  try {
    const res = await $fetch<ArrayBuffer>('/api/speak', {
      method: 'POST',
      body: { text: ttsInput.value },
      responseType: 'arrayBuffer',
    });

    // Play raw linear16 PCM at 24 kHz via Web Audio API
    const ctx = new AudioContext({ sampleRate: 24000 });
    const int16 = new Int16Array(res);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) {
      float32[i] = int16[i] / 32768;
    }

    const audioBuffer = ctx.createBuffer(1, float32.length, 24000);
    audioBuffer.getChannelData(0).set(float32);

    const source = ctx.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(ctx.destination);
    source.onended = () => { isSpeaking.value = false; ctx.close(); };
    source.start();
  } catch (err) {
    console.error('TTS error:', err);
    isSpeaking.value = false;
  }
}

onBeforeUnmount(() => {
  stopRecording();
});
</script>

<template>
  <div class="container">
    <h1>Nuxt + Deepgram Streaming STT &amp; TTS</h1>

    <section class="stt-section">
      <h2>Speech-to-Text</h2>
      <p class="status">{{ statusMessage }}</p>

      <div class="controls">
        <button v-if="!isRecording" @click="startRecording" class="btn btn-start">
          Start
        </button>
        <button v-else @click="stopRecording" class="btn btn-stop">
          Stop
        </button>
      </div>

      <div class="transcript-box">
        <p v-for="(t, i) in transcripts" :key="i" class="transcript-final">
          {{ t.text }}
        </p>
        <p v-if="interimText" class="transcript-interim">{{ interimText }}</p>
        <p v-if="!transcripts.length && !interimText" class="transcript-placeholder">
          Transcripts will appear here…
        </p>
      </div>
    </section>

    <section class="tts-section">
      <h2>Text-to-Speech</h2>
      <div class="tts-controls">
        <input
          v-model="ttsInput"
          type="text"
          placeholder="Type text to speak…"
          class="tts-input"
          @keyup.enter="speakText"
        />
        <button
          @click="speakText"
          :disabled="isSpeaking || !ttsInput.trim()"
          class="btn btn-speak"
        >
          {{ isSpeaking ? 'Playing…' : 'Speak' }}
        </button>
      </div>
    </section>
  </div>
</template>

<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, -apple-system, sans-serif; background: #0a0a0a; color: #e0e0e0; }

.container { max-width: 700px; margin: 0 auto; padding: 2rem 1rem; }
h1 { text-align: center; margin-bottom: 2rem; color: #13ef93; }
h2 { margin-bottom: 0.75rem; font-size: 1.2rem; }

.status { color: #999; font-size: 0.9rem; margin-bottom: 0.75rem; }
.controls { margin-bottom: 1rem; }

.btn {
  padding: 0.6rem 1.5rem; border: none; border-radius: 6px;
  font-size: 1rem; cursor: pointer; transition: opacity 0.2s;
}
.btn:hover { opacity: 0.85; }
.btn:disabled { opacity: 0.4; cursor: not-allowed; }
.btn-start { background: #13ef93; color: #000; }
.btn-stop { background: #ef4444; color: #fff; }
.btn-speak { background: #3b82f6; color: #fff; }

.transcript-box {
  background: #111; border: 1px solid #333; border-radius: 8px;
  padding: 1rem; min-height: 120px; max-height: 400px; overflow-y: auto;
}
.transcript-final { margin-bottom: 0.4rem; }
.transcript-interim { color: #666; font-style: italic; }
.transcript-placeholder { color: #555; }

.tts-section { margin-top: 2rem; }
.tts-controls { display: flex; gap: 0.5rem; }
.tts-input {
  flex: 1; padding: 0.6rem; border: 1px solid #333; border-radius: 6px;
  background: #111; color: #e0e0e0; font-size: 1rem;
}
.tts-input::placeholder { color: #555; }
</style>
