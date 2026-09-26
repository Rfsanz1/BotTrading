import { Injectable } from '@nestjs/common';
import { CanonicalMarketState } from '../interfaces/canonical-market.interface';
import { MultiTimeframeAlignment } from './multi-timeframe.service';
import { StructureState } from './market-structure.service';

export type MarketRegime = 'TREND_UP' | 'TREND_DOWN' | 'RANGE' | 'BREAKOUT_UP' | 'BREAKOUT_DOWN' | 'VOLATILITY_EXPANSION' | 'VOLATILITY_COMPRESSION' | 'CHOP' | 'LIQUIDATION_EVENT' | 'LOW_LIQUIDITY' | 'DATA_DEGRADED';

export interface RegimeResult {
  regime: MarketRegime;
  regimeStrength: number;
  regimeConfidence: number;
  reasons: string[];
  invalidation: string;
}

@Injectable()
export class RegimeService {
  evaluate(state: CanonicalMarketState, alignment: MultiTimeframeAlignment, structure?: StructureState): RegimeResult {
    if (state.dataQuality.state === 'INVALID') return this.result('DATA_DEGRADED', 1, ['DATA_INVALID'], 'Restore valid market data');
    if (state.dataQuality.state === 'DEGRADED') return this.result('DATA_DEGRADED', 0.8, state.dataQuality.reasons, 'Restore fresh synchronized streams');
    const liquidity = state.orderBook?.bidDepth10 && state.orderBook.askDepth10
      ? state.orderBook.bidDepth10 + state.orderBook.askDepth10 : null;
    if (liquidity !== null && liquidity <= 0) return this.result('LOW_LIQUIDITY', 0.9, ['EMPTY_ORDERBOOK_DEPTH'], 'Order book depth must recover');
    if (state.liquidation.level === 'LIQUIDATION_SPIKE') return this.result('LIQUIDATION_EVENT', 0.95, ['LIQUIDATION_SPIKE'], 'Liquidation intensity must normalize');
    const latest = state.timeframes[alignment.entryTimeframe];
    if (latest?.volatility !== null && latest?.volatility !== undefined && latest.volatility > 0.03) {
      return this.result('VOLATILITY_EXPANSION', 0.85, ['ENTRY_TIMEFRAME_VOLATILITY_EXPANSION'], 'Volatility must return within risk limits');
    }
    if (structure?.trend === 'BULLISH' && alignment.higherTimeframeBias === 'BULLISH') {
      return this.result('BREAKOUT_UP', Math.max(alignment.timeframeAlignment, 0.7), ['STRUCTURE_BULLISH_BREAKOUT'], 'Protected low must hold');
    }
    if (structure?.trend === 'BEARISH' && alignment.higherTimeframeBias === 'BEARISH') {
      return this.result('BREAKOUT_DOWN', Math.max(alignment.timeframeAlignment, 0.7), ['STRUCTURE_BEARISH_BREAKOUT'], 'Protected high must hold');
    }
    if (alignment.timeframeConflict) return this.result('CHOP', 1 - alignment.timeframeAlignment, ['TIMEFRAME_CONFLICT'], 'Resolve higher/lower timeframe conflict');
    if (alignment.higherTimeframeBias === 'BULLISH') return this.result('TREND_UP', alignment.timeframeAlignment, ['HIGHER_TIMEFRAME_BULLISH'], 'Break below higher-timeframe structure');
    if (alignment.higherTimeframeBias === 'BEARISH') return this.result('TREND_DOWN', alignment.timeframeAlignment, ['HIGHER_TIMEFRAME_BEARISH'], 'Break above higher-timeframe structure');
    return this.result('RANGE', 1 - alignment.timeframeAlignment, ['NO_DOMINANT_DIRECTION'], 'Range breakout invalidates regime');
  }

  private result(regime: MarketRegime, confidence: number, reasons: string[], invalidation: string): RegimeResult {
    return { regime, regimeStrength: Math.min(1, Math.max(0, confidence)), regimeConfidence: Math.min(1, Math.max(0, confidence)), reasons, invalidation };
  }
}
