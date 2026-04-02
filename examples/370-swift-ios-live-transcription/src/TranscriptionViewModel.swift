import Foundation
import SwiftUI

@MainActor
final class TranscriptionViewModel: ObservableObject {
    enum State {
        case idle
        case listening
        case error(String)
    }

    @Published var state: State = .idle
    @Published var finalTranscript: String = ""
    @Published var interimText: String = ""

    private var deepgramClient: DeepgramClient?
    private let audioCapture = AudioCaptureManager()

    // In production, fetch a short-lived key from your backend instead.
    // Shipping a long-lived API key in a mobile binary means anyone can
    // extract it with a decompiler.
    private var apiKey: String {
        ProcessInfo.processInfo.environment["DEEPGRAM_API_KEY"] ?? ""
    }

    func toggleListening() {
        switch state {
        case .idle, .error:
            startListening()
        case .listening:
            stopListening()
        }
    }

    func clearTranscript() {
        finalTranscript = ""
        interimText = ""
    }

    private func startListening() {
        guard !apiKey.isEmpty else {
            state = .error("DEEPGRAM_API_KEY not set. Add it to your environment or scheme.")
            return
        }

        let client = DeepgramClient(apiKey: apiKey)
        let coordinator = Coordinator(viewModel: self)
        client.delegate = coordinator
        audioCapture.delegate = coordinator
        self.deepgramClient = client
        self._coordinator = coordinator

        client.connect()

        do {
            try audioCapture.startCapture()
            state = .listening
        } catch {
            state = .error("Microphone access failed: \(error.localizedDescription)")
        }
    }

    private func stopListening() {
        audioCapture.stopCapture()
        deepgramClient?.disconnect()
        deepgramClient = nil
        state = .idle
    }

    // Coordinator bridges delegate callbacks to the @MainActor view model
    private var _coordinator: Coordinator?

    private final class Coordinator: DeepgramClientDelegate, AudioCaptureDelegate {
        private weak var viewModel: TranscriptionViewModel?

        init(viewModel: TranscriptionViewModel) {
            self.viewModel = viewModel
        }

        func deepgramDidConnect() {}

        func deepgramDidDisconnect(error: Error?) {
            Task { @MainActor [weak self] in
                guard let vm = self?.viewModel else { return }
                if let error = error {
                    vm.state = .error("Disconnected: \(error.localizedDescription)")
                }
            }
        }

        func deepgramDidReceiveTranscript(_ text: String, isFinal: Bool) {
            Task { @MainActor [weak self] in
                guard let vm = self?.viewModel else { return }
                if isFinal {
                    // Append to committed transcript; clear partial
                    let separator = vm.finalTranscript.isEmpty ? "" : " "
                    vm.finalTranscript += separator + text
                    vm.interimText = ""
                } else {
                    vm.interimText = text
                }
            }
        }

        func audioCaptureDidReceive(pcmData: Data) {
            Task { @MainActor [weak self] in
                self?.viewModel?.deepgramClient?.sendAudio(pcmData)
            }
        }
    }
}
