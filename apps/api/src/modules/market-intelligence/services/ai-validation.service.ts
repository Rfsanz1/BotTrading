import { Injectable } from '@nestjs/common';

export interface StructuredAiValidation {
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  setupType: string;
  confidenceRaw: number;
  supportingFactors: string[];
  conflictingFactors: string[];
  riskWarnings: string[];
  invalidation: string;
  rationale: string;
  provider?: string;
  model?: string;
  gateway?: string;
  decisionTimestamp?: number;
}

export type AiValidationResult =
  | { state: 'VALID'; value: StructuredAiValidation }
  | { state: 'AI_INVALID' | 'AI_UNAVAILABLE' | 'AI_AUTH_ERROR' | 'AI_RATE_LIMITED' | 'AI_SERVER_ERROR'; reason: string };

@Injectable()
export class AiValidationService {
  validate(input: unknown): AiValidationResult {
    if (input === undefined || input === null) return { state: 'AI_UNAVAILABLE', reason: 'AI validation output unavailable' };
    if (typeof input !== 'object') return { state: 'AI_INVALID', reason: 'AI output must be an object' };
    const value = input as Record<string, unknown>;
    if (['AI_UNAVAILABLE', 'AI_INVALID', 'AI_AUTH_ERROR', 'AI_RATE_LIMITED', 'AI_SERVER_ERROR'].includes(String(value.state))) {
      return { state: value.state as Exclude<AiValidationResult, { state: 'VALID' }>['state'], reason: String(value.reason ?? value.state) };
    }
    if (value.state === 'AI_VALID' && value.value && typeof value.value === 'object') return this.validate(value.value);
    const direction = value.direction;
    const confidenceRaw = value.confidenceRaw;
    const arrays = ['supportingFactors', 'conflictingFactors', 'riskWarnings'];
    if (!['LONG', 'SHORT', 'NEUTRAL'].includes(String(direction))
      || typeof confidenceRaw !== 'number' || !Number.isFinite(confidenceRaw) || confidenceRaw < 0 || confidenceRaw > 1
      || typeof value.setupType !== 'string' || typeof value.invalidation !== 'string' || typeof value.rationale !== 'string'
      || arrays.some((key) => !Array.isArray(value[key]) || (value[key] as unknown[]).some((item) => typeof item !== 'string'))) {
      return { state: 'AI_INVALID', reason: 'AI output does not match the structured validation schema' };
    }
    return {
      state: 'VALID',
      value: {
        direction: direction as StructuredAiValidation['direction'],
        setupType: value.setupType as string,
        confidenceRaw,
        supportingFactors: value.supportingFactors as string[],
        conflictingFactors: value.conflictingFactors as string[],
        riskWarnings: value.riskWarnings as string[],
        invalidation: value.invalidation as string,
        rationale: value.rationale as string,
        ...(typeof value.provider === 'string' ? { provider: value.provider } : {}),
        ...(typeof value.model === 'string' ? { model: value.model } : {}),
        ...(typeof value.gateway === 'string' ? { gateway: value.gateway } : {}),
        ...(typeof value.decisionTimestamp === 'number' ? { decisionTimestamp: value.decisionTimestamp } : {}),
      },
    };
  }
}
