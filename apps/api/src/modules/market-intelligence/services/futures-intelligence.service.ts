import { Injectable } from '@nestjs/common';

export interface RollingStats {
  mean: number;
  std: number;
  zScore: number;
  percentile: number;
}

@Injectable()
export class FuturesIntelligenceService {
  fundingFeatures(history: number[], current: number): RollingStats & { delta: number | null; regime: 'POSITIVE' | 'NEGATIVE' | 'NEUTRAL' } {
    const stats = this.stats(history, current) ?? { mean: current, std: 0, zScore: 0, percentile: 0.5 };
    const previous = history.at(-1);
    return {
      ...stats,
      delta: previous === undefined ? null : current - previous,
      regime: current > 0 ? 'POSITIVE' : current < 0 ? 'NEGATIVE' : 'NEUTRAL',
    };
  }

  openInterestFeatures(history: number[], current: number): RollingStats & { delta: number | null; pctChange: number | null; trend: 'INCREASING' | 'DECREASING' | 'FLAT' } {
    const stats = this.stats(history, current) ?? { mean: current, std: 0, zScore: 0, percentile: 0.5 };
    const change = this.delta(history, current);
    return {
      ...stats,
      delta: change.delta,
      pctChange: change.pctChange,
      trend: (change.delta ?? 0) > 0 ? 'INCREASING' : (change.delta ?? 0) < 0 ? 'DECREASING' : 'FLAT',
    };
  }

  stats(history: number[], current: number): RollingStats | null {
    if (!Number.isFinite(current) || history.length < 2) return null;
    const values = [...history, current];
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
    const std = Math.sqrt(variance);
    const sorted = [...values].sort((a, b) => a - b);
    const rank = sorted.filter((value) => value <= current).length;
    return { mean, std, zScore: std === 0 ? 0 : (current - mean) / std, percentile: rank / values.length };
  }

  basis(lastPrice: number, markPrice: number, indexPrice: number): { basis: number; basisPct: number } {
    if (![lastPrice, markPrice, indexPrice].every(Number.isFinite) || indexPrice === 0) throw new Error('Invalid futures prices');
    const value = lastPrice - indexPrice;
    return { basis: value, basisPct: value / indexPrice };
  }

  delta(history: number[], current: number): { delta: number | null; pctChange: number | null } {
    const previous = history.at(-1);
    if (previous === undefined || !Number.isFinite(previous) || previous === 0) return { delta: null, pctChange: null };
    return { delta: current - previous, pctChange: (current - previous) / Math.abs(previous) };
  }
}
