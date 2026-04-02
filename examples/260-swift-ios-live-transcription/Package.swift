// swift-tools-version: 5.9
import PackageDescription

// This Package.swift exists so the example can be opened as a Swift package.
// For a full Xcode project, create a new iOS App target and drag the files
// from src/ into it. The app has no external dependencies — only Apple
// frameworks (AVFoundation, SwiftUI, Foundation).

let package = Package(
    name: "DeepgramLiveTranscription",
    platforms: [.iOS(.v17)],
    targets: [
        .executableTarget(
            name: "DeepgramLiveTranscription",
            path: "src"
        ),
    ]
)
