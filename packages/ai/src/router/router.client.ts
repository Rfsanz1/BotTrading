import { Injectable, Inject } from '@nestjs/common';
import axios, { AxiosInstance, AxiosError, AxiosResponse } from 'axios';
import { createLogger } from '@rfsanz/logger';
import type { Logger } from '@rfsanz/logger';
import type { Readable } from 'stream';

import type { RouterConfig } from './router.config';
import { ROUTER_CONFIG } from './router.config';
import type {
  AIChatRequest,
  AIChatResponse,
  AIModelsResponse,
  AIStreamChunk,
  AIEmbeddingRequest,
  AIEmbeddingResponse,
} from '../core/ai.types';

/**
 * Low-level Axios client for the 9Router gateway.
 * Handles auth headers, base URL, and SSE stream parsing.
 * All other logic (retry, timeout, logging) lives in RouterService.
 */
@Injectable()
export class RouterClient {
  private readonly http: AxiosInstance;
  private readonly log: Logger;

  constructor(@Inject(ROUTER_CONFIG) private readonly config: RouterConfig) {
    this.log = createLogger('RouterClient');

    this.http = axios.create({
      baseURL: config.baseUrl,
      headers: {
        'Content-Type': 'application/json',
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
      },
      timeout: config.timeoutMs,
    });

    this.http.interceptors.response.use(
      (res) => res,
      (err: AxiosError) => {
        const status = err.response?.status;
        const body   = err.response?.data;
        this.log.warn({ status, body, url: err.config?.url }, 'RouterClient HTTP error');
        return Promise.reject(err);
      },
    );
  }

  // ─── Chat (non-streaming) ─────────────────────────────────────────────────

  async chatCompletions(request: AIChatRequest): Promise<AIChatResponse> {
    const res: AxiosResponse<AIChatResponse> = await this.http.post(
      '/chat/completions',
      { ...request, stream: false },
    );
    return res.data;
  }

  // ─── Chat (streaming) — returns SSE as async generator ───────────────────

  async *streamCompletions(
    request: AIChatRequest,
  ): AsyncGenerator<AIStreamChunk, void, unknown> {
    const res: AxiosResponse<Readable> = await this.http.post(
      '/chat/completions',
      { ...request, stream: true },
      { responseType: 'stream' },
    );

    const stream = res.data;
    let buffer = '';

    for await (const raw of stream) {
      buffer += (raw as Buffer).toString('utf8');
      const lines = buffer.split('\n');
      // Keep last (potentially incomplete) line in buffer
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'data: [DONE]') continue;
        if (!trimmed.startsWith('data: ')) continue;

        const json = trimmed.slice(6); // strip "data: "
        try {
          const chunk = JSON.parse(json) as AIStreamChunk;
          yield chunk;
        } catch {
          this.log.warn({ line: trimmed }, 'Failed to parse SSE chunk');
        }
      }
    }
  }

  // ─── Models ───────────────────────────────────────────────────────────────

  async getModels(): Promise<AIModelsResponse> {
    const res: AxiosResponse<AIModelsResponse> = await this.http.get('/models');
    return res.data;
  }

  // ─── Embeddings ───────────────────────────────────────────────────────────

  async createEmbedding(request: AIEmbeddingRequest): Promise<AIEmbeddingResponse> {
    const res: AxiosResponse<AIEmbeddingResponse> = await this.http.post(
      '/embeddings',
      request,
    );
    return res.data;
  }

  // ─── Raw health ping ──────────────────────────────────────────────────────

  async ping(model: string): Promise<{ latencyMs: number }> {
    const start = Date.now();
    await this.http.post('/chat/completions', {
      model,
      messages: [{ role: 'user', content: 'ping' }],
      max_tokens: 1,
      stream: false,
    } satisfies AIChatRequest);
    return { latencyMs: Date.now() - start };
  }
}
