import { Injectable } from '@nestjs/common';
import { CanonicalTimeframe, TimeframeFeatureState } from '../interfaces/canonical-market.interface';

export interface MultiTimeframeAlignment {
  higherTimeframeBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  timeframeAlignment: number;
  timeframeConflict: boolean;
  entryTimeframe: CanonicalTimeframe;
  reasons: string[];
}

@Injectable()
export class MultiTimeframeService {
  private readonly hierarchy: CanonicalTimeframe[] = ['1d', '4h', '1h', '15m', '5m', '1m'];

  align(features: Partial<Record<CanonicalTimeframe, TimeframeFeatureState>>): MultiTimeframeAlignment {
    const available = this.hierarchy.map((timeframe) => features[timeframe]).filter(Boolean) as TimeframeFeatureState[];
    const signed = available.map((feature) => feature.trend === 'BULLISH' ? 1 : feature.trend === 'BEARISH' ? -1 : 0);
    const score = signed.length ? signed.reduce((sum, value) => sum + value, 0) / signed.length : 0;
    const higher = features['1d']?.trend === 'BULLISH' || features['4h']?.trend === 'BULLISH'
      ? 'BULLISH' : features['1d']?.trend === 'BEARISH' || features['4h']?.trend === 'BEARISH' ? 'BEARISH' : 'NEUTRAL';
    const conflict = Boolean(features['1d'] && features['4h'] && features['1d'].trend !== features['4h'].trend
      || features['1h'] && features['15m'] && features['1h'].trend !== features['15m'].trend);
    const entryTimeframe = features['5m'] ? '5m' : features['15m'] ? '15m' : '1m';
    return {
      higherTimeframeBias: higher,
      timeframeAlignment: Math.abs(score),
      timeframeConflict: conflict,
      entryTimeframe,
      reasons: conflict ? ['HIGHER_LOWER_TIMEFRAME_CONFLICT'] : [`${available.length} timeframes aligned`],
    };
  }
}
