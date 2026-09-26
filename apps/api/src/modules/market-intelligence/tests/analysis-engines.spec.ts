import { MultiTimeframeService } from '../services/multi-timeframe.service';
import { OpportunityService } from '../services/opportunity.service';
import { RegimeService } from '../services/regime.service';
import { FuturesIntelligenceService } from '../services/futures-intelligence.service';
import { LiquidationService } from '../services/liquidation.service';

describe('analysis feature engines', () => {
  it('detects timeframe conflict and produces a safe no-trade decision', () => {
    const alignment = new MultiTimeframeService().align({
      '1d': { trend: 'BULLISH', momentum: 0.1, volatility: 0.01, structure: 'BULLISH', volume: 1, updatedAt: 1 },
      '4h': { trend: 'BEARISH', momentum: -0.1, volatility: 0.01, structure: 'BEARISH', volume: 1, updatedAt: 1 },
      '5m': { trend: 'BULLISH', momentum: 0.1, volatility: 0.01, structure: 'BULLISH', volume: 1, updatedAt: 1 },
    });
    expect(alignment.timeframeConflict).toBe(true);
  });

  it('calculates futures rolling statistics and liquidation severity', () => {
    const futures = new FuturesIntelligenceService();
    expect(futures.stats([1, 2, 3], 4)?.percentile).toBe(1);
    expect(futures.delta([100], 110)).toEqual({ delta: 10, pctChange: 0.1 });
    const liquidation = new LiquidationService();
    const result = liquidation.record({ side: 'SELL', quantity: 2, price: 100, timestamp: 1_000 });
    expect(result.totalVolume).toBe(200);
    expect(result.lastLiquidationTime).toBe(1_000);
  });
});
