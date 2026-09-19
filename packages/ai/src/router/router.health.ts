import { Injectable, Inject } from '@nestjs/common';
import { createLogger } from '@rfsanz/logger';
import type { Logger } from '@rfsanz/logger';

import type { AIHealthStatus, AIHealthState } from '../core/ai.types';
import { RouterClient } from './router.client';
import { ROUTER_CONFIG, type RouterConfig } from './router.config';

/**
 * Tracks liveness of the 9Router gateway.
 * Performs periodic background pings and caches the latest status so callers
 * can query health synchronously without incurring an extra network round-trip.
 */
@Injectable()
export class RouterHealth {
  private readonly log: Logger;
  private latest: AIHealthStatus;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly client: RouterClient,
    @Inject(ROUTER_CONFIG) private readonly config: RouterConfig,
  ) {
    this.log = createLogger('RouterHealth');
    this.latest = this.unknown();
  }

  // ─── Start / stop periodic checks ────────────────────────────────────────

  startPeriodicChecks(): void {
    if (this.timer) return;
    this.log.info(
      { intervalMs: this.config.healthIntervalMs },
      'RouterHealth periodic checks started',
    );
    // Run once immediately, then on schedule
    void this.check();
    this.timer = setInterval(() => void this.check(), this.config.healthIntervalMs);
  }

  stopPeriodicChecks(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      this.log.info('RouterHealth periodic checks stopped');
    }
  }

  // ─── check() — perform a live ping ───────────────────────────────────────

  async check(): Promise<AIHealthStatus> {
    const model = this.config.healthModel;

    try {
      const { latencyMs } = await this.client.ping(model);

      const status: AIHealthStatus = {
        status:    this.classify(latencyMs),
        latencyMs,
        model,
        baseUrl:   this.config.baseUrl,
        checkedAt: Date.now(),
      };

      this.latest = status;
      this.log.debug(
        { status: status.status, latencyMs },
        'RouterHealth check OK',
      );
      return status;
    } catch (error) {
      const status: AIHealthStatus = {
        status:    'down',
        latencyMs: -1,
        model,
        baseUrl:   this.config.baseUrl,
        checkedAt: Date.now(),
      };

      this.latest = status;
      this.log.warn(
        { error: (error as Error).message },
        'RouterHealth check FAILED',
      );
      return status;
    }
  }

  // ─── getCached() — return last known status without network call ──────────

  getCached(): AIHealthStatus {
    return this.latest;
  }

  // ─── helpers ──────────────────────────────────────────────────────────────

  private classify(latencyMs: number): AIHealthState {
    if (latencyMs < 0)       return 'down';
    if (latencyMs < 5_000)   return 'ok';
    if (latencyMs < 15_000)  return 'degraded';
    return 'down';
  }

  private unknown(): AIHealthStatus {
    return {
      status:    'down',
      latencyMs: -1,
      model:     '',
      baseUrl:   '',
      checkedAt: 0,
    };
  }
}
