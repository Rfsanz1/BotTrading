import { Controller, Get } from '@nestjs/common';
import { SystemReadinessService } from '@rfsanz/exchange';
import { Public } from '../../common/public.decorator';
import { PaperOperationalService } from './paper-operational.service';

@Controller('health')
export class HealthController {
  private readonly readinessService = SystemReadinessService.getInstance();

  constructor(private readonly operational: PaperOperationalService) {}

  @Get()
  @Public()
  health() { return { ok: true, timestamp: Date.now() }; }

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

  @Get('operational')
  @Public()
  operationalHealth() {
    return {
      ok: this.operational.report().state !== 'FAILED',
      ...this.operational.report(),
      timestamp: Date.now(),
    };
  }

  @Get('paper-metrics')
  @Public()
  paperMetrics() {
    return {
      ok: true,
      metrics: this.operational.metrics(),
      timestamp: Date.now(),
    };
  }
}
