/// Minimal Deepgram REST client for pre-recorded speech-to-text.
///
/// There is no official Deepgram Dart SDK. This file wraps the REST API
/// (https://developers.deepgram.com/reference/listen-file) with proper
/// `Authorization: Token <key>` headers. If an official SDK is released,
/// replace this file with SDK calls.
library;

import 'dart:convert';
import 'dart:typed_data';

import 'package:http/http.dart' as http;

class DeepgramTranscription {
  final String transcript;
  final double confidence;
  final double durationSeconds;
  final int wordCount;

  DeepgramTranscription({
    required this.transcript,
    required this.confidence,
    required this.durationSeconds,
    required this.wordCount,
  });
}

class DeepgramClient {
  final String apiKey;
  // Base URL for the Deepgram REST API. Override for self-hosted instances.
  final String baseUrl;

  DeepgramClient({
    required this.apiKey,
    this.baseUrl = 'https://api.deepgram.com',
  });

  /// Transcribe audio bytes using Deepgram's pre-recorded STT endpoint.
  ///
  /// [audioBytes] — raw audio data. Deepgram auto-detects the format from
  /// the file header (WAV, OGG, MP3, FLAC, WebM, M4A, etc.).
  ///
  /// [model] — nova-3 is the current flagship model (2025). For phone call
  /// audio use nova-3-phonecall; for medical dictation use nova-3-medical.
  ///
  /// [smartFormat] — adds punctuation, capitalisation, paragraph breaks, and
  /// formats numbers/dates/currency. Adds ~10 ms latency — almost always
  /// worth enabling.
  Future<DeepgramTranscription> transcribeFile(
    Uint8List audioBytes, {
    String model = 'nova-3',
    bool smartFormat = true,
    String? language,
  }) async {
    final queryParams = {
      'model': model,
      'smart_format': smartFormat.toString(),
      if (language != null) 'language': language,
    };

    final uri = Uri.parse('$baseUrl/v1/listen').replace(
      queryParameters: queryParams,
    );

    // Deepgram REST API: POST raw audio bytes with Content-Type header.
    // The API auto-detects format from the stream, but sending the correct
    // MIME type can avoid ambiguity for headerless raw PCM.
    final response = await http.post(
      uri,
      headers: {
        'Authorization': 'Token $apiKey',
        'Content-Type': 'audio/wav',
      },
      body: audioBytes,
    );

    if (response.statusCode != 200) {
      // Common errors:
      //   401 — invalid or missing API key
      //   402 — free-tier quota exceeded (not a code bug)
      //   400 — unsupported audio format or empty body
      throw Exception(
        'Deepgram API error ${response.statusCode}: ${response.body}',
      );
    }

    final json = jsonDecode(response.body);
    final alt = json['results']['channels'][0]['alternatives'][0];
    final words = alt['words'] as List<dynamic>? ?? [];
    final duration = words.isNotEmpty ? (words.last['end'] as num).toDouble() : 0.0;

    return DeepgramTranscription(
      transcript: alt['transcript'] as String? ?? '',
      confidence: (alt['confidence'] as num?)?.toDouble() ?? 0.0,
      durationSeconds: duration,
      wordCount: words.length,
    );
  }

  /// Transcribe audio from a public URL.
  ///
  /// Deepgram fetches the URL server-side — the audio never passes through
  /// the client device. Faster and more bandwidth-efficient than uploading.
  Future<DeepgramTranscription> transcribeUrl(
    String url, {
    String model = 'nova-3',
    bool smartFormat = true,
    String? language,
  }) async {
    final queryParams = {
      'model': model,
      'smart_format': smartFormat.toString(),
      if (language != null) 'language': language,
    };

    final uri = Uri.parse('$baseUrl/v1/listen').replace(
      queryParameters: queryParams,
    );

    final response = await http.post(
      uri,
      headers: {
        'Authorization': 'Token $apiKey',
        'Content-Type': 'application/json',
      },
      body: jsonEncode({'url': url}),
    );

    if (response.statusCode != 200) {
      throw Exception(
        'Deepgram API error ${response.statusCode}: ${response.body}',
      );
    }

    final json = jsonDecode(response.body);
    final alt = json['results']['channels'][0]['alternatives'][0];
    final words = alt['words'] as List<dynamic>? ?? [];
    final duration = words.isNotEmpty ? (words.last['end'] as num).toDouble() : 0.0;

    return DeepgramTranscription(
      transcript: alt['transcript'] as String? ?? '',
      confidence: (alt['confidence'] as num?)?.toDouble() ?? 0.0,
      durationSeconds: duration,
      wordCount: words.length,
    );
  }
}
