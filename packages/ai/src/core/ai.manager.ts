import { Injectable, Inject } from '@nestjs/common';
import { createLogger } from '@rfsanz/logger';
import type { Logger } from '@rfsanz/logger';

import type { IAIManager } from './ai.interface';
import type {
  AIMessage,
  AIManagerOptions,
  AIManagerResult,
  AIHealthStatus,
  AIStreamChunk,
} from './ai.types';
import type { IRouterService } from './ai.interface';
import { withRetry, withTimeout } from '../utils';
import { ROUTER_SERVICE } from '../router/router.config';

@Injectable()
export class AIManager implements IAIManager {
  private readonly log: Logger;

  constructor(
    @Inject(ROUTER_SERVICE)
    private readonly router: IRouterService,
  ) {
    this.log = createLogger('AIManager');
  }

  // ─── Execute (sync) ────────────────────────────────────────────────────────

  async execute(
    messages: AIMessage[],
    options: AIManagerOptions = {},
  ): Promise<AIManagerResult> {
    const retries = options.retries ?? 3;
    const timeoutMs = options.timeoutMs ?? 30_000;
    const model = options.model;

    const start = Date.now();
    let attempts = 0;
    let status: AIManagerResult['status'] = 'success';

    this.log.debug(
      { model, messageCount: messages.length, retries, timeoutMs },
      'AIManager.execute started',
    );

    try {
      const response = await withRetry(
        () =>
          withTimeout(
            () => this.router.chat(messages, options),
            timeoutMs,
          ),
        {
          retries,
          delayMs: 1_000,
          factor: 2,
          onRetry: (attempt, error) => {
            attempts = attempt;
            status = 'retried';
            this.log.warn(
              { attempt, model, error: (error as Error).message },
              'AIManager retry attempt',
            );
          },
        },
      );

      const latencyMs = Date.now() - start;
      this.log.info(
        {
          model: response.model,
          latencyMs,
          tokens: response.usage.total_tokens,
          attempts: attempts || 1,
        },
        'AIManager.execute completed',
      );

      return {
        response,
        latencyMs,
        attempts: attempts || 1,
        status,
        model: response.model,
      };
    } catch (error) {
      const latencyMs = Date.now() - start;
      const isTimeout = (error as Error).message?.includes('timed out');
      status = isTimeout ? 'timeout' : 'error';

      this.log.error(
        { model, latencyMs, attempts, error: (error as Error).message, status },
        'AIManager.execute failed',
      );
      throw error;
    }
  }

  // ─── Execute stream ────────────────────────────────────────────────────────

  async *executeStream(
    messages: AIMessage[],
    options: AIManagerOptions = {},
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    const model = options.model;

    this.log.debug(
      { model, messageCount: messages.length },
      'AIManager.executeStream started',
    );

    try {
      yield* this.router.stream(messages, { ...options, stream: true } as AIManagerOptions & { stream: boolean });
    } catch (error) {
      this.log.error(
        { model, error: (error as Error).message },
        'AIManager.executeStream failed',
      );
      throw error;
    }
  }

  // ─── Health ────────────────────────────────────────────────────────────────

  async healthCheck(): Promise<AIHealthStatus> {
    this.log.debug('AIManager.healthCheck called');
    const status = await this.router.health();
    this.log.info(
      { status: status.status, latencyMs: status.latencyMs },
      'AIManager health check result',
    );
    return status;
  }
}
