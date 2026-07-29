import { Injectable } from '@nestjs/common';
import { createLogger } from '@rfsanz/logger';
import type { Logger } from '@rfsanz/logger';

import type { AIManagerResult, AIScoreResult, TradingAction } from '../core/ai.types';

export interface ScoringWeights {
  /** Weight for AI confidence (0–1). Default: 0.5 */
  confidence: number;
  /** Weight for low latency (faster = better). Default: 0.2 */
  latency: number;
  /** Weight for first-attempt success (no retries). Default: 0.2 */
  reliability: number;
  /** Weight for token efficiency. Default: 0.1 */
  tokenEfficiency: number;
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  confidence:      0.5,
  latency:         0.2,
  reliability:     0.2,
  tokenEfficiency: 0.1,
};

/**
 * Scores AI responses on a 0–100 scale using configurable weights.
 * Used to compare results when running consensus across multiple calls,
 * or to decide whether to accept a signal or re-prompt.
 */
@Injectable()
export class AIResponseScorer {
  private readonly log: Logger;
  private readonly weights: ScoringWeights;

  constructor(weights: ScoringWeights = DEFAULT_WEIGHTS) {
    this.log    = createLogger('AIResponseScorer');
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
  }

  // ─── Score a single result ────────────────────────────────────────────────

  score(result: AIManagerResult, aiConfidence: number): AIScoreResult {
    const confidenceScore    = aiConfidence; // already 0–100
    const latencyScore       = this.scoreLatency(result.latencyMs);
    const reliabilityScore   = result.attempts === 1 ? 100 : Math.max(0, 100 - (result.attempts - 1) * 25);
    const tokenScore         = this.scoreTokenEfficiency(result.response.usage.total_tokens);

    const raw =
      confidenceScore  * this.weights.confidence +
      latencyScore     * this.weights.latency +
      reliabilityScore * this.weights.reliability +
      tokenScore       * this.weights.tokenEfficiency;

    const final = Math.round(Math.min(100, Math.max(0, raw)));

    const tags = this.buildTags(result, aiConfidence);

    this.log.debug(
      {
        final,
        confidenceScore,
        latencyScore,
        reliabilityScore,
        tokenScore,
        model: result.model,
      },
      'AIResponseScorer.score',
    );

    return {
      score:      final,
      confidence: aiConfidence,
      reasoning:  this.buildReasoning(final, aiConfidence, result),
      tags,
    };
  }

  // ─── Consensus helper — pick the best of multiple results ────────────────

  selectBest(
    results: Array<{ result: AIManagerResult; aiConfidence: number; action: TradingAction }>,
  ): { index: number; scored: AIScoreResult } {
    const scored = results.map(({ result, aiConfidence }) =>
      this.score(result, aiConfidence),
    );

    let bestIdx = 0;
    let bestScore = -1;
    for (let i = 0; i < scored.length; i++) {
      if ((scored[i]?.score ?? 0) > bestScore) {
        bestScore = scored[i]?.score ?? 0;
        bestIdx   = i;
      }
    }

    return { index: bestIdx, scored: scored[bestIdx] as AIScoreResult };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private scoreLatency(ms: number): number {
    if (ms <= 1_000)  return 100;
    if (ms <= 3_000)  return 80;
    if (ms <= 5_000)  return 60;
    if (ms <= 10_000) return 40;
    if (ms <= 20_000) return 20;
    return 0;
  }

  private scoreTokenEfficiency(tokens: number): number {
    // Fewer tokens for the same quality is better; cap the ceiling
    if (tokens <= 200)  return 100;
    if (tokens <= 500)  return 80;
    if (tokens <= 1000) return 60;
    if (tokens <= 2000) return 40;
    return 20;
  }

  private buildTags(result: AIManagerResult, confidence: number): string[] {
    const tags: string[] = [];
    if (confidence >= 80)      tags.push('high-confidence');
    if (confidence < 50)       tags.push('low-confidence');
    if (result.latencyMs < 2_000) tags.push('fast-response');
    if (result.latencyMs > 10_000) tags.push('slow-response');
    if (result.attempts > 1)   tags.push('retried');
    if (result.status === 'timeout') tags.push('timeout');
    return tags;
  }

  private buildReasoning(
    score: number,
    confidence: number,
    result: AIManagerResult,
  ): string {
    const parts: string[] = [
      `Score: ${score}/100`,
      `AI confidence: ${confidence}%`,
      `Latency: ${result.latencyMs}ms`,
      result.attempts > 1 ? `Retried ${result.attempts - 1}x` : 'First attempt',
    ];
    return parts.join(', ');
  }
}
