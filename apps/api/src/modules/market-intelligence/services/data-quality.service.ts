import { Injectable } from '@nestjs/common';

export type DataQualityState = 'HEALTHY' | 'DEGRADED' | 'INVALID';

export interface DataQualityInput {
  now?: number;
  maxAgeMs: number;
  observedAt?: number;
  required?: boolean;
  streamHealthy?: boolean;
  sequenceHealthy?: boolean;
  clockSkewMs?: number;
  maxClockSkewMs?: number;
}

export interface DataQualityResult {
  state: DataQualityState;
  reasons: string[];
  ageMs: number | null;
}

@Injectable()
export class DataQualityService {
  evaluate(input: DataQualityInput): DataQualityResult {
    const now = input.now ?? Date.now();
    const reasons: string[] = [];
    const ageMs = input.observedAt === undefined ? null : Math.max(0, now - input.observedAt);
    const required = input.required ?? true;

    if (input.observedAt === undefined) {
      reasons.push(required ? 'DATA_MISSING' : 'DATA_UNAVAILABLE');
    } else if (ageMs! > input.maxAgeMs) {
      reasons.push('DATA_STALE');
    }
    if (input.streamHealthy === false) reasons.push('WEBSOCKET_UNHEALTHY');
    if (input.sequenceHealthy === false) reasons.push('SEQUENCE_INVALID');
    if (input.clockSkewMs !== undefined && Math.abs(input.clockSkewMs) > (input.maxClockSkewMs ?? 1_000)) {
      reasons.push('CLOCK_SKEW');
    }

    const hasInvalid = reasons.some((reason) => ['DATA_MISSING', 'SEQUENCE_INVALID', 'CLOCK_SKEW'].includes(reason));
    return {
      state: hasInvalid ? 'INVALID' : reasons.length > 0 ? 'DEGRADED' : 'HEALTHY',
      reasons,
      ageMs,
    };
  }
}
