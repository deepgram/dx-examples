import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:path_provider/path_provider.dart';
import 'package:permission_handler/permission_handler.dart';
import 'package:record/record.dart';

import 'deepgram_client.dart';

class TranscriptionScreen extends StatefulWidget {
  const TranscriptionScreen({super.key});

  @override
  State<TranscriptionScreen> createState() => _TranscriptionScreenState();
}

class _TranscriptionScreenState extends State<TranscriptionScreen> {
  final AudioRecorder _recorder = AudioRecorder();
  bool _isRecording = false;
  bool _isTranscribing = false;
  String _transcript = '';
  String? _error;

  @override
  void dispose() {
    _recorder.dispose();
    super.dispose();
  }

  Future<void> _toggleRecording() async {
    if (_isRecording) {
      await _stopAndTranscribe();
    } else {
      await _startRecording();
    }
  }

  Future<void> _startRecording() async {
    // Request microphone permission. On iOS this triggers the system dialog;
    // on Android it uses the runtime permission flow. The app's Info.plist
    // (iOS) and AndroidManifest.xml must declare microphone usage.
    final status = await Permission.microphone.request();
    if (!status.isGranted) {
      setState(() => _error = 'Microphone permission denied');
      return;
    }

    final dir = await getTemporaryDirectory();
    final path = '${dir.path}/recording.wav';

    // Record as WAV (LINEAR16 PCM) at 16 kHz mono — this is the format
    // Deepgram processes most efficiently. Higher sample rates (44.1k, 48k)
    // work but increase upload size with minimal accuracy benefit for speech.
    await _recorder.start(
      const RecordConfig(
        encoder: AudioEncoder.wav,
        sampleRate: 16000,
        numChannels: 1,
      ),
      path: path,
    );

    setState(() {
      _isRecording = true;
      _error = null;
      _transcript = '';
    });
  }

  Future<void> _stopAndTranscribe() async {
    final path = await _recorder.stop();
    setState(() => _isRecording = false);

    if (path == null) {
      setState(() => _error = 'No audio recorded');
      return;
    }

    setState(() => _isTranscribing = true);

    try {
      final apiKey = dotenv.env['DEEPGRAM_API_KEY'] ?? '';
      if (apiKey.isEmpty) {
        throw Exception(
          'DEEPGRAM_API_KEY not set. Add it to .env or pass via your backend.',
        );
      }

      final client = DeepgramClient(apiKey: apiKey);
      final audioBytes = await File(path).readAsBytes();

      final result = await client.transcribeFile(
        audioBytes,
        model: 'nova-3',
        smartFormat: true,
      );

      setState(() {
        _transcript = result.transcript.isEmpty
            ? 'No speech detected — try speaking more clearly or for longer.'
            : result.transcript;
        _isTranscribing = false;
      });
    } catch (e) {
      setState(() {
        _error = e.toString();
        _isTranscribing = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Deepgram Transcription')),
      body: Padding(
        padding: const EdgeInsets.all(24),
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Center(
              child: FilledButton.icon(
                onPressed: _isTranscribing ? null : _toggleRecording,
                icon: Icon(_isRecording ? Icons.stop : Icons.mic),
                label: Text(
                  _isRecording
                      ? 'Stop Recording'
                      : _isTranscribing
                          ? 'Transcribing…'
                          : 'Start Recording',
                ),
                style: FilledButton.styleFrom(
                  padding: const EdgeInsets.symmetric(
                    horizontal: 32,
                    vertical: 16,
                  ),
                  backgroundColor: _isRecording ? Colors.red : null,
                ),
              ),
            ),
            const SizedBox(height: 32),
            if (_isTranscribing) const Center(child: CircularProgressIndicator()),
            if (_error != null)
              Text(
                _error!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            if (_transcript.isNotEmpty)
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: SelectableText(
                    _transcript,
                    style: Theme.of(context).textTheme.bodyLarge,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
