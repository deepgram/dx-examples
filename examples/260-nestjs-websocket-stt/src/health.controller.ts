import { Controller, Get } from '@nestjs/common';

@Controller()
export class HealthController {
  @Get('health')
  check() {
    return { status: 'ok', service: 'deepgram-nestjs-websocket-stt' };
  }
}
