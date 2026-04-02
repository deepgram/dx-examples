import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { DeepgramService } from './deepgram.service';

// Each connected client gets its own Deepgram live session
interface ClientSession {
  dgConnection: any;
  ready: boolean;
}

@WebSocketGateway({ cors: { origin: '*' } })
export class TranscriptionGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  server!: Server;

  private sessions = new Map<string, ClientSession>();

  constructor(private readonly deepgramService: DeepgramService) {}

  async handleConnection(client: Socket) {
    console.log(`[gateway] Client connected: ${client.id}`);

    try {
      const dgConnection = await this.deepgramService.createLiveConnection(
        // Forward transcript events back to this specific client
        (event) => {
          const tag = event.isFinal ? 'final' : 'interim';
          console.log(`[${tag}] ${event.transcript}`);
          client.emit('transcript', event);
        },
        (err) => {
          client.emit('error', { message: err.message });
          this.cleanupSession(client.id);
        },
        () => {
          this.cleanupSession(client.id);
        },
      );

      this.sessions.set(client.id, { dgConnection, ready: true });
      client.emit('ready', { message: 'Deepgram connection established' });
    } catch (err: any) {
      console.error(`[gateway] Failed to create Deepgram session for ${client.id}:`, err.message);
      client.emit('error', { message: 'Failed to connect to Deepgram' });
      client.disconnect();
    }
  }

  handleDisconnect(client: Socket) {
    console.log(`[gateway] Client disconnected: ${client.id}`);
    this.cleanupSession(client.id);
  }

  // Browser sends raw audio chunks via the 'audio' event
  @SubscribeMessage('audio')
  handleAudio(client: Socket, data: Buffer | ArrayBuffer) {
    const session = this.sessions.get(client.id);
    if (!session?.ready || !session.dgConnection) return;

    try {
      const buffer = Buffer.isBuffer(data) ? data : Buffer.from(data);
      session.dgConnection.sendMedia(buffer);
    } catch {
      // Connection may have closed between the ready check and send
    }
  }

  private cleanupSession(clientId: string) {
    const session = this.sessions.get(clientId);
    if (!session) return;

    session.ready = false;
    this.sessions.delete(clientId);
    if (session.dgConnection) {
      try { session.dgConnection.sendCloseStream({ type: 'CloseStream' }); } catch {}
      try { session.dgConnection.removeAllListeners(); } catch {}
      try { session.dgConnection.close(); } catch {}
    }
  }
}
