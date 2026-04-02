package com.deepgram.example.livetranscription

import android.app.Application
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import com.deepgram.DeepgramClient
import com.deepgram.resources.listen.v1.websocket.V1ConnectOptions
import com.deepgram.resources.listen.v1.websocket.V1WebSocketClient
import com.deepgram.types.ListenV1Encoding
import com.deepgram.types.ListenV1InterimResults
import com.deepgram.types.ListenV1Model
import com.deepgram.types.ListenV1SampleRate
import com.deepgram.types.ListenV1SmartFormat
import com.deepgram.types.ListenV1Tag
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

data class TranscriptionUiState(
    val isRecording: Boolean = false,
    val transcript: String = "",
    val interimText: String = "",
    val error: String? = null
)

class TranscriptionViewModel(application: Application) : AndroidViewModel(application) {

    private val _uiState = MutableStateFlow(TranscriptionUiState())
    val uiState: StateFlow<TranscriptionUiState> = _uiState.asStateFlow()

    private val audioRecorder = AudioRecorder(application)
    private var recordingJob: Job? = null
    private var wsClient: V1WebSocketClient? = null

    fun toggleRecording() {
        if (_uiState.value.isRecording) {
            stopRecording()
        } else {
            startRecording()
        }
    }

    private fun startRecording() {
        if (!audioRecorder.hasPermission()) {
            _uiState.value = _uiState.value.copy(error = "Microphone permission required")
            return
        }

        val apiKey = BuildConfig.DEEPGRAM_API_KEY
        if (apiKey.isBlank()) {
            _uiState.value = _uiState.value.copy(error = "DEEPGRAM_API_KEY not set")
            return
        }

        _uiState.value = _uiState.value.copy(
            isRecording = true,
            error = null,
            interimText = ""
        )

        viewModelScope.launch {
            try {
                val client = DeepgramClient.builder()
                    .apiKey(apiKey)
                    .build()

                val ws = client.listen().v1().websocket()
                wsClient = ws

                // Interim results let the UI show partial transcripts as the user speaks
                ws.onResults { results ->
                    val alt = results.channel.alternatives.firstOrNull()
                    val text = alt?.transcript ?: ""
                    if (text.isNotBlank()) {
                        val isFinal = results.isFinal
                        if (isFinal) {
                            // Append finalized text to the full transcript
                            _uiState.value = _uiState.value.copy(
                                transcript = (_uiState.value.transcript + " " + text).trim(),
                                interimText = ""
                            )
                        } else {
                            _uiState.value = _uiState.value.copy(interimText = text)
                        }
                    }
                }

                ws.onError { error ->
                    _uiState.value = _uiState.value.copy(
                        error = "WebSocket error: ${error.message}",
                        isRecording = false
                    )
                }

                // tag="deepgram-examples" ← REQUIRED to identify example traffic in console
                ws.connect(
                    V1ConnectOptions.builder()
                        .model(ListenV1Model.NOVA3)
                        .encoding(ListenV1Encoding.LINEAR16)
                        .sampleRate(ListenV1SampleRate.of(16000))
                        .interimResults(ListenV1InterimResults.TRUE)
                        .smartFormat(ListenV1SmartFormat.TRUE)
                        .tag(ListenV1Tag.of("deepgram-examples"))
                        .build()
                ).get()

                // Stream microphone audio chunks directly to Deepgram
                recordingJob = viewModelScope.launch {
                    audioRecorder.recordChunks().collect { chunk ->
                        ws.send(chunk)
                    }
                }
            } catch (e: Exception) {
                _uiState.value = _uiState.value.copy(
                    error = "Connection failed: ${e.message}",
                    isRecording = false
                )
            }
        }
    }

    private fun stopRecording() {
        recordingJob?.cancel()
        recordingJob = null
        wsClient?.close()
        wsClient = null
        _uiState.value = _uiState.value.copy(isRecording = false, interimText = "")
    }

    fun clearTranscript() {
        _uiState.value = _uiState.value.copy(transcript = "", interimText = "")
    }

    override fun onCleared() {
        super.onCleared()
        stopRecording()
    }
}
