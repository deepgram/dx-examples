import Foundation

// Deepgram live STT WebSocket client.
// There is no official Deepgram Swift SDK. This wraps the WebSocket API
// (wss://api.deepgram.com/v1/listen) with URLSessionWebSocketTask.
// If an official SDK is released, replace this file with SDK calls.

struct DeepgramTranscriptMessage: Decodable {
    let type: String
    let channel: Channel?
    let isFinal: Bool?
    let speechFinal: Bool?

    enum CodingKeys: String, CodingKey {
        case type, channel
        case isFinal = "is_final"
        case speechFinal = "speech_final"
    }

    struct Channel: Decodable {
        let alternatives: [Alternative]
    }

    struct Alternative: Decodable {
        let transcript: String
        let confidence: Double
    }
}

protocol DeepgramClientDelegate: AnyObject {
    func deepgramDidConnect()
    func deepgramDidDisconnect(error: Error?)
    func deepgramDidReceiveTranscript(_ text: String, isFinal: Bool)
}

final class DeepgramClient {
    weak var delegate: DeepgramClientDelegate?

    private var webSocketTask: URLSessionWebSocketTask?
    private let apiKey: String
    // nova-3 is the current flagship STT model (2025)
    private let model: String
    private let sampleRate: Int
    private let encoding: String

    init(apiKey: String, model: String = "nova-3", sampleRate: Int = 16000, encoding: String = "linear16") {
        self.apiKey = apiKey
        self.model = model
        self.sampleRate = sampleRate
        self.encoding = encoding
    }

    func connect() {
        // tag=deepgram-examples — required to identify example traffic in the Deepgram console
        var components = URLComponents(string: "wss://api.deepgram.com/v1/listen")!
        components.queryItems = [
            URLQueryItem(name: "model", value: model),
            URLQueryItem(name: "encoding", value: encoding),
            URLQueryItem(name: "sample_rate", value: String(sampleRate)),
            URLQueryItem(name: "channels", value: "1"),
            URLQueryItem(name: "interim_results", value: "true"),
            // ← THIS enables utterance-level endpointing so we get speech_final
            URLQueryItem(name: "utterance_end_ms", value: "1000"),
            URLQueryItem(name: "tag", value: "deepgram-examples"),
        ]

        var request = URLRequest(url: components.url!)
        // iOS URLSession supports custom headers on WebSocket (unlike browsers)
        request.setValue("Token \(apiKey)", forHTTPHeaderField: "Authorization")

        let session = URLSession(configuration: .default)
        webSocketTask = session.webSocketTask(with: request)
        webSocketTask?.resume()

        delegate?.deepgramDidConnect()
        listenForMessages()
    }

    func sendAudio(_ data: Data) {
        webSocketTask?.send(.data(data)) { error in
            if let error = error {
                print("WebSocket send error: \(error)")
            }
        }
    }

    func disconnect() {
        // Send CloseStream message per Deepgram protocol to flush final results
        let closeMessage = #"{"type": "CloseStream"}"#
        webSocketTask?.send(.string(closeMessage)) { [weak self] _ in
            self?.webSocketTask?.cancel(with: .normalClosure, reason: nil)
            self?.webSocketTask = nil
            self?.delegate?.deepgramDidDisconnect(error: nil)
        }
    }

    private func listenForMessages() {
        webSocketTask?.receive { [weak self] result in
            switch result {
            case .success(let message):
                switch message {
                case .string(let text):
                    self?.handleMessage(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        self?.handleMessage(text)
                    }
                @unknown default:
                    break
                }
                // Keep listening for more messages
                self?.listenForMessages()

            case .failure(let error):
                self?.delegate?.deepgramDidDisconnect(error: error)
            }
        }
    }

    private func handleMessage(_ text: String) {
        guard let data = text.data(using: .utf8),
              let message = try? JSONDecoder().decode(DeepgramTranscriptMessage.self, from: data),
              message.type == "Results",
              let transcript = message.channel?.alternatives.first?.transcript,
              !transcript.isEmpty
        else { return }

        // is_final=true means Deepgram won't revise this segment further
        let isFinal = message.isFinal ?? false
        DispatchQueue.main.async { [weak self] in
            self?.delegate?.deepgramDidReceiveTranscript(transcript, isFinal: isFinal)
        }
    }
}
