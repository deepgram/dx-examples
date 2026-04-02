package com.deepgram.example.livetranscription

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.MediaRecorder
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.coroutines.isActive
import kotlin.coroutines.coroutineContext

// 16 kHz mono LINEAR16 — matches Deepgram's most efficient input format
private const val SAMPLE_RATE = 16_000
private const val CHANNEL_CONFIG = AudioFormat.CHANNEL_IN_MONO
private const val AUDIO_FORMAT = AudioFormat.ENCODING_PCM_16BIT

class AudioRecorder(private val context: Context) {

    private var audioRecord: AudioRecord? = null

    fun hasPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    // Streams raw PCM chunks as byte arrays — each chunk is ~100ms of audio
    fun recordChunks(): Flow<ByteArray> = flow {
        val bufferSize = maxOf(
            AudioRecord.getMinBufferSize(SAMPLE_RATE, CHANNEL_CONFIG, AUDIO_FORMAT),
            SAMPLE_RATE * 2 // ← 1 second of 16-bit mono at 16 kHz = 32 000 bytes
        )

        val recorder = AudioRecord(
            MediaRecorder.AudioSource.MIC,
            SAMPLE_RATE,
            CHANNEL_CONFIG,
            AUDIO_FORMAT,
            bufferSize
        ).also { audioRecord = it }

        // ~100ms read chunks keep latency low without overwhelming the WebSocket
        val chunkSize = SAMPLE_RATE * 2 / 10
        val buffer = ByteArray(chunkSize)

        recorder.startRecording()
        try {
            while (coroutineContext.isActive) {
                val read = recorder.read(buffer, 0, chunkSize)
                if (read > 0) {
                    emit(buffer.copyOf(read))
                }
            }
        } finally {
            recorder.stop()
            recorder.release()
            audioRecord = null
        }
    }.flowOn(Dispatchers.IO)

    fun stop() {
        audioRecord?.stop()
    }
}
