import { Injectable } from '@nestjs/common';
import { createLogger } from '@rfsanz/logger';
import type { Logger } from '@rfsanz/logger';

import { RouterClient } from '../router/router.client';
import type { AIEmbeddingResponse } from '../core/ai.types';

export interface EmbeddingOptions {
  /** Override the default embedding model. */
  model?: string;
  encoding_format?: 'float' | 'base64';
}

/**
 * Wraps 9Router's `/v1/embeddings` endpoint.
 * Embeddings are used for semantic similarity, RAG pipelines, and
 * market-event clustering.
 */
@Injectable()
export class EmbeddingsService {
  private readonly log: Logger;
  private static readonly DEFAULT_MODEL = 'text-embedding-3-small';

  constructor(private readonly client: RouterClient) {
    this.log = createLogger('EmbeddingsService');
  }

  // ─── Single text ──────────────────────────────────────────────────────────

  async embed(text: string, options: EmbeddingOptions = {}): Promise<number[]> {
    const res = await this.request([text], options);
    return res.data[0]?.embedding ?? [];
  }

  // ─── Batch ────────────────────────────────────────────────────────────────

  async embedBatch(
    texts: string[],
    options: EmbeddingOptions = {},
  ): Promise<number[][]> {
    if (texts.length === 0) return [];
    const res = await this.request(texts, options);
    return res.data.map((d) => d.embedding);
  }

  // ─── Cosine similarity ────────────────────────────────────────────────────

  /**
   * Compute cosine similarity between two embedding vectors.
   * Returns a value in [-1, 1]; 1 = identical direction.
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dot   += (a[i] ?? 0) * (b[i] ?? 0);
      normA += (a[i] ?? 0) ** 2;
      normB += (b[i] ?? 0) ** 2;
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  /**
   * Rank texts by semantic similarity to a query.
   * Returns indices sorted by descending similarity.
   */
  async rankBySimilarity(
    query: string,
    candidates: string[],
    options: EmbeddingOptions = {},
  ): Promise<Array<{ index: number; text: string; similarity: number }>> {
    if (candidates.length === 0) return [];

    const [queryVec, ...candidateVecs] = await this.embedBatch(
      [query, ...candidates],
      options,
    );

    if (!queryVec) return [];

    return candidates
      .map((text, i) => ({
        index:      i,
        text,
        similarity: EmbeddingsService.cosineSimilarity(queryVec, candidateVecs[i] ?? []),
      }))
      .sort((a, b) => b.similarity - a.similarity);
  }

  // ─── Private ──────────────────────────────────────────────────────────────

  private async request(
    input: string[],
    options: EmbeddingOptions,
  ): Promise<AIEmbeddingResponse> {
    const model = options.model ?? EmbeddingsService.DEFAULT_MODEL;
    this.log.debug({ model, count: input.length }, 'EmbeddingsService.request');

    return this.client.createEmbedding({
      model,
      input,
      encoding_format: options.encoding_format ?? 'float',
    });
  }
}
