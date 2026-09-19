import { Injectable, Inject } from '@nestjs/common';
import { createLogger } from '@rfsanz/logger';
import type { Logger } from '@rfsanz/logger';

import type { IRouterService } from '../core/ai.interface';
import type {
  AIMessage,
  AIChatResponse,
  AIStreamChunk,
  AIModel,
  AIHealthStatus,
  AIManagerOptions,
  AIEmbeddingRequest,
  AIEmbeddingResponse,
} from '../core/ai.types';
import { RouterClient } from './router.client';
import { RouterHealth } from './router.health';
import { ROUTER_CONFIG, type RouterConfig } from './router.config';
import { withRetry, withTimeout } from '../utils';

/**
 * Primary consumer-facing service for the 9Router gateway.
 * Implements IRouterService and adds retry, timeout, and logging on top of
 * the thin RouterClient.
 */
@Injectable()
export class RouterService implements IRouterService {
  private readonly log: Logger;

  constructor(
    private readonly client: RouterClient,
    private readonly healthService: RouterHealth,
    @Inject(ROUTER_CONFIG) private readonly config: RouterConfig,
  ) {
    this.log = createLogger('RouterService');
  }

  // ─── chat() ───────────────────────────────────────────────────────────────

  async chat(
    messages: AIMessage[],
    options: AIManagerOptions = {},
  ): Promise<AIChatResponse> {
    const model     = options.model      ?? this.config.defaultModel;
    const timeoutMs = options.timeoutMs  ?? this.config.timeoutMs;
    const retries   = options.retries    ?? this.config.maxRetries;

    this.log.debug({ model, messages: messages.length }, 'RouterService.chat');

    return withRetry(
      () =>
        withTimeout(
          () =>
            this.client.chatCompletions({
              model,
              messages,
              temperature:   options.temperature,
              max_tokens:    options.maxTokens,
              stream:        false,
            }),
          timeoutMs,
        ),
      {
        retries,
        delayMs: this.config.retryDelayMs,
        factor:  2,
        onRetry: (attempt, err) => {
          this.log.warn(
            { attempt, model, error: (err as Error).message },
            'RouterService.chat retry',
          );
        },
      },
    );
  }

  // ─── stream() ─────────────────────────────────────────────────────────────

  async *stream(
    messages: AIMessage[],
    options: AIManagerOptions = {},
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    const model = options.model ?? this.config.defaultModel;

    this.log.debug({ model, messages: messages.length }, 'RouterService.stream');

    yield* this.client.streamCompletions({
      model,
      messages,
      temperature: options.temperature,
      max_tokens:  options.maxTokens,
      stream:      true,
    });
  }

  // ─── listModels() ─────────────────────────────────────────────────────────

  async listModels(): Promise<AIModel[]> {
    this.log.debug('RouterService.listModels');
    const res = await this.client.getModels();
    return res.data;
  }

  // ─── health() ─────────────────────────────────────────────────────────────

  async health(): Promise<AIHealthStatus> {
    return this.healthService.check();
  }

  // ─── embeddings() ─────────────────────────────────────────────────────────

  async embeddings(request: AIEmbeddingRequest): Promise<AIEmbeddingResponse> {
    this.log.debug({ model: request.model }, 'RouterService.embeddings');
    return this.client.createEmbedding(request);
  }
}
