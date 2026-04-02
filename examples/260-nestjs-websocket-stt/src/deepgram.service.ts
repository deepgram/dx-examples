import { Injectable } from '@nestjs/common';
import { DeepgramClient } from '@deepgram/sdk';

// Deepgram live transcription options — model + tag are required
const LIVE_OPTIONS = {
  model: 'nova-3' as const,
  smart_format: 'true' as const,
  interim_results: 'true' as const,
  utterance_end_ms: '1000',
  encoding: 'linear16' as const,
  channels: '1',
  sample_rate: '16000',
  tag: 'deepgram-examples',   // ← REQUIRED: tags usage in Deepgram console
};

export interface TranscriptEvent {
  transcript: string;
  isFinal: boolean;
  speechFinal: boolean;
}

@Injectable()
export class DeepgramService {
  private client: DeepgramClient;

  constructor() {
    this.client = new DeepgramClient({
      apiKey: process.env.DEEPGRAM_API_KEY!,
    });
  }

  // Creates a Deepgram live connection and wires up events to callbacks
  async createLiveConnection(
    onTranscript: (event: TranscriptEvent) => void,
    onError: (err: Error) => void,
    onClose: () => void,
  ) {
    const connection = await this.client.listen.v1.connect({
      ...LIVE_OPTIONS,
      Authorization: `Token ${process.env.DEEPGRAM_API_KEY}`,
    });

    connection.on('open', () => {
      console.log('[deepgram] Connection opened');
    });

    // data.channel.alternatives[0].transcript holds the text
    connection.on('message', (data: any) => {
      const transcript = data?.channel?.alternatives?.[0]?.transcript;
      if (transcript) {
        onTranscript({
          transcript,
          isFinal: !!data.is_final,
          speechFinal: !!data.speech_final,
        });
      }
    });

    connection.on('error', (err: any) => {
      console.error('[deepgram] Error:', err.message || err);
      onError(err instanceof Error ? err : new Error(String(err)));
    });

    connection.on('close', () => {
      console.log('[deepgram] Connection closed');
      onClose();
    });

    connection.connect();
    await connection.waitForOpen();

    return connection;
  }
}
