import 'package:flutter/material.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

import 'transcription_screen.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  // Load .env for local development. In production, inject DEEPGRAM_API_KEY
  // via your backend — never ship API keys in mobile binaries.
  await dotenv.load(fileName: ".env").catchError((_) {});
  runApp(const DeepgramTranscriptionApp());
}

class DeepgramTranscriptionApp extends StatelessWidget {
  const DeepgramTranscriptionApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Deepgram Voice Transcription',
      theme: ThemeData(
        colorSchemeSeed: Colors.deepPurple,
        useMaterial3: true,
      ),
      home: const TranscriptionScreen(),
    );
  }
}
