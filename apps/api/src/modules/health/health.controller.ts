import { Controller, Get } from '@nestjs/common';
import { SystemReadinessService } from '@rfsanz/exchange';
import { Public } from '../../common/public.decorator';

@Controller('health')
export class HealthController {
  private readonly readinessService = SystemReadinessService.getInstance();

  @Get('live')
  @Public()
  liveness() { return { ok: true, timestamp: Date.now() }; }

  @Get('ready')
  readiness() {
    const report = this.readinessService.report();
    return {
      ok: report.ready,
      mode: process.env.TRADING_MODE ?? 'PAPER',
      ready: report.ready,
      phase: report.phase,
      checks: report.checks,
      reason: report.reason,
      timestamp: Date.now(),
    };
  }

  @Get('readiness')
  readinessDetails() {
    return this.readiness();
  }
}
