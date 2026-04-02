import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const transcriptEl = document.getElementById("transcript")!;
const btnStart = document.getElementById("btn-start") as HTMLButtonElement;
const btnStop = document.getElementById("btn-stop") as HTMLButtonElement;
const statusEl = document.getElementById("status")!;

const MAX_LINES = 6;
const finalLines: string[] = [];
let currentInterim = "";

let mediaStream: MediaStream | null = null;
let audioContext: AudioContext | null = null;
let processorNode: ScriptProcessorNode | null = null;

function renderTranscript() {
  const visible = finalLines.slice(-MAX_LINES);
  let html = visible.map((l) => `<span>${l}</span>`).join("<br>");
  if (currentInterim) {
    html += `<br><span class="interim">${currentInterim}</span>`;
  }
  transcriptEl.innerHTML = html || "Listening...";
}

// Capture microphone at 16 kHz, convert float32 to linear16 PCM,
// and forward each chunk to the Rust backend via Tauri command.
async function startAudioCapture() {
  mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });

  // 16 kHz matches the Deepgram encoding config exactly
  audioContext = new AudioContext({ sampleRate: 16000 });
  const source = audioContext.createMediaStreamSource(mediaStream);

  // ScriptProcessorNode is deprecated but universally supported in
  // WebView contexts. AudioWorklet is the modern alternative but adds
  // file complexity not warranted for this example.
  processorNode = audioContext.createScriptProcessor(4096, 1, 1);

  processorNode.onaudioprocess = (event: AudioProcessingEvent) => {
    const float32 = event.inputBuffer.getChannelData(0);

    // Convert float32 [-1, 1] → signed 16-bit PCM
    const int16 = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const s = Math.max(-1, Math.min(1, float32[i]));
      int16[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }

    invoke("send_audio", { audio: Array.from(new Uint8Array(int16.buffer)) });
  };

  source.connect(processorNode);
  processorNode.connect(audioContext.destination);
}

function stopAudioCapture() {
  if (processorNode) {
    processorNode.disconnect();
    processorNode = null;
  }
  if (audioContext) {
    audioContext.close();
    audioContext = null;
  }
  if (mediaStream) {
    mediaStream.getTracks().forEach((t) => t.stop());
    mediaStream = null;
  }
}

btnStart.addEventListener("click", async () => {
  btnStart.disabled = true;
  btnStop.disabled = false;
  btnStart.classList.add("active");
  btnStop.classList.remove("active");

  finalLines.length = 0;
  currentInterim = "";
  transcriptEl.textContent = "Connecting...";

  await invoke("start_transcription");
  await startAudioCapture();
});

btnStop.addEventListener("click", async () => {
  btnStop.disabled = true;
  btnStart.disabled = false;
  btnStop.classList.remove("active");
  btnStart.classList.remove("active");

  stopAudioCapture();
  await invoke("stop_transcription");
  statusEl.textContent = "disconnected";
  statusEl.className = "status";
});

listen<{ text: string; is_final: boolean; speech_final: boolean; confidence: number }>(
  "transcript",
  (event) => {
    if (event.payload.is_final) {
      finalLines.push(event.payload.text);
      currentInterim = "";
    } else {
      currentInterim = event.payload.text;
    }
    renderTranscript();
  }
);

listen<string>("dg-status", (event) => {
  statusEl.textContent = event.payload;
  statusEl.className = `status ${event.payload}`;
});

listen<string>("dg-error", (event) => {
  statusEl.textContent = `error: ${event.payload}`;
  statusEl.className = "status error";
});

listen("utterance-end", () => {
  if (currentInterim) {
    finalLines.push(currentInterim);
    currentInterim = "";
    renderTranscript();
  }
});
