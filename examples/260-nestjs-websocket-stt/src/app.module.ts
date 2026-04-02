import { Module } from '@nestjs/common';
import { DeepgramService } from './deepgram.service';
import { TranscriptionGateway } from './transcription.gateway';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
  providers: [DeepgramService, TranscriptionGateway],
})
export class AppModule {}
