import AVFoundation

// Captures microphone audio using AVAudioEngine and delivers raw PCM buffers.
// AVAudioEngine is preferred over AVAudioRecorder because it provides a
// streaming tap (real-time buffer callback) rather than writing to a file.

protocol AudioCaptureDelegate: AnyObject {
    func audioCaptureDidReceive(pcmData: Data)
}

final class AudioCaptureManager {
    weak var delegate: AudioCaptureDelegate?

    private let engine = AVAudioEngine()
    // 16 kHz mono LINEAR16 — matches the DeepgramClient's default encoding
    private let desiredSampleRate: Double = 16000.0
    private let desiredChannels: UInt32 = 1

    func startCapture() throws {
        let session = AVAudioSession.sharedInstance()
        // .measurement avoids system audio processing (echo cancellation, AGC)
        // which would distort the audio for transcription
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let inputNode = engine.inputNode
        let inputFormat = inputNode.outputFormat(forBus: 0)

        // Convert hardware format → 16 kHz mono Int16 for Deepgram
        guard let targetFormat = AVAudioFormat(
            commonFormat: .pcmFormatInt16,
            sampleRate: desiredSampleRate,
            channels: AVAudioChannelCount(desiredChannels),
            interleaved: true
        ) else {
            throw AudioCaptureError.formatCreationFailed
        }

        guard let converter = AVAudioConverter(from: inputFormat, to: targetFormat) else {
            throw AudioCaptureError.converterCreationFailed
        }

        // Buffer size: 100 ms of audio at input sample rate
        let bufferSize = AVAudioFrameCount(inputFormat.sampleRate * 0.1)

        inputNode.installTap(onBus: 0, bufferSize: bufferSize, format: inputFormat) { [weak self] buffer, _ in
            self?.convert(buffer: buffer, converter: converter, targetFormat: targetFormat)
        }

        try engine.start()
    }

    func stopCapture() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()

        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    private func convert(buffer: AVAudioPCMBuffer, converter: AVAudioConverter, targetFormat: AVAudioFormat) {
        let frameCapacity = AVAudioFrameCount(
            Double(buffer.frameLength) * (targetFormat.sampleRate / buffer.format.sampleRate)
        )
        guard frameCapacity > 0,
              let outputBuffer = AVAudioPCMBuffer(pcmFormat: targetFormat, frameCapacity: frameCapacity)
        else { return }

        var error: NSError?
        var hasData = true
        converter.convert(to: outputBuffer, error: &error) { _, outStatus in
            if hasData {
                hasData = false
                outStatus.pointee = .haveData
                return buffer
            }
            outStatus.pointee = .noDataNow
            return nil
        }

        if let error = error {
            print("Audio conversion error: \(error)")
            return
        }

        // Extract raw Int16 bytes from the converted buffer
        guard let channelData = outputBuffer.int16ChannelData else { return }
        let byteCount = Int(outputBuffer.frameLength) * MemoryLayout<Int16>.size
        let data = Data(bytes: channelData[0], count: byteCount)
        delegate?.audioCaptureDidReceive(pcmData: data)
    }
}

enum AudioCaptureError: LocalizedError {
    case formatCreationFailed
    case converterCreationFailed

    var errorDescription: String? {
        switch self {
        case .formatCreationFailed:
            return "Failed to create target audio format (16 kHz mono Int16)"
        case .converterCreationFailed:
            return "Failed to create audio converter from input to target format"
        }
    }
}
