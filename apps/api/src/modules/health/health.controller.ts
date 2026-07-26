import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get('live')
  liveness() { return { ok: true, timestamp: Date.now() }; }

  @Get('ready')
  readiness() { return { ok: true, db: true, redis: true, timestamp: Date.now() }; }
}
