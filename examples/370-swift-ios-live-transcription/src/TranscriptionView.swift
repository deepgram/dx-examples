import SwiftUI

struct TranscriptionView: View {
    @StateObject private var viewModel = TranscriptionViewModel()

    var body: some View {
        NavigationStack {
            VStack(spacing: 24) {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 8) {
                            if !viewModel.finalTranscript.isEmpty {
                                Text(viewModel.finalTranscript)
                                    .font(.body)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                            }

                            if !viewModel.interimText.isEmpty {
                                Text(viewModel.interimText)
                                    .font(.body)
                                    .foregroundStyle(.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .id("interim")
                            }

                            if viewModel.finalTranscript.isEmpty && viewModel.interimText.isEmpty {
                                Text("Tap the microphone to start transcribing.")
                                    .font(.body)
                                    .foregroundStyle(.tertiary)
                                    .frame(maxWidth: .infinity, alignment: .center)
                                    .padding(.top, 40)
                            }
                        }
                        .padding(.horizontal)
                    }
                    .onChange(of: viewModel.interimText) {
                        withAnimation { proxy.scrollTo("interim", anchor: .bottom) }
                    }
                }

                if case .error(let message) = viewModel.state {
                    Text(message)
                        .font(.caption)
                        .foregroundStyle(.red)
                        .padding(.horizontal)
                }

                HStack(spacing: 20) {
                    Button(action: viewModel.toggleListening) {
                        Image(systemName: isListening ? "stop.circle.fill" : "mic.circle.fill")
                            .font(.system(size: 56))
                            .foregroundStyle(isListening ? .red : .blue)
                    }
                    .accessibilityLabel(isListening ? "Stop transcription" : "Start transcription")

                    if !viewModel.finalTranscript.isEmpty || !viewModel.interimText.isEmpty {
                        Button(action: viewModel.clearTranscript) {
                            Image(systemName: "trash.circle.fill")
                                .font(.system(size: 40))
                                .foregroundStyle(.secondary)
                        }
                        .accessibilityLabel("Clear transcript")
                    }
                }
                .padding(.bottom, 16)
            }
            .navigationTitle("Deepgram Live STT")
        }
    }

    private var isListening: Bool {
        if case .listening = viewModel.state { return true }
        return false
    }
}
