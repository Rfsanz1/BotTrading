import { AiValidationService } from '../services/ai-validation.service';
import { EntryExitService } from '../services/entry-exit.service';
import { ExpectedValueService } from '../services/expected-value.service';
import { MarketStructureService } from '../services/market-structure.service';
import { TradingCostModel } from '../services/trading-cost-model';

describe('deterministic decision layer', () => {
  it('uses funding only for Futures cost calculations', () => {
    const oldSpotFee = process.env.TRADING_SPOT_TAKER_FEE_RATE;
    const oldFuturesFee = process.env.TRADING_FUTURES_TAKER_FEE_RATE;
    process.env.TRADING_SPOT_TAKER_FEE_RATE = '0.001';
    process.env.TRADING_FUTURES_TAKER_FEE_RATE = '0.001';
    const costs = new TradingCostModel();
    const spot = costs.estimate({
      marketType: 'spot', entryPrice: 100, stopLoss: 98, spreadFraction: 0.001,
      slippageFraction: 0.001, fundingRate: null, holdingTimeMs: 8 * 60 * 60 * 1000,
    });
    const futures = costs.estimate({
      marketType: 'futures', entryPrice: 100, stopLoss: 98, spreadFraction: 0.001,
      slippageFraction: 0.001, fundingRate: 0.0002, holdingTimeMs: 8 * 60 * 60 * 1000,
    });
    expect(spot.fundingFraction).toBe(0);
    expect(futures.fundingFraction).toBe(0.0002);
    if (oldSpotFee === undefined) delete process.env.TRADING_SPOT_TAKER_FEE_RATE;
    else process.env.TRADING_SPOT_TAKER_FEE_RATE = oldSpotFee;
    if (oldFuturesFee === undefined) delete process.env.TRADING_FUTURES_TAKER_FEE_RATE;
    else process.env.TRADING_FUTURES_TAKER_FEE_RATE = oldFuturesFee;
  });

  it('validates AI schema and rejects malformed output', () => {
    const service = new AiValidationService();
    expect(service.validate({ direction: 'LONG', setupType: 'BREAKOUT', confidenceRaw: 0.7, supportingFactors: [], conflictingFactors: [], riskWarnings: [], invalidation: 'below swing', rationale: 'structured' }).state).toBe('VALID');
    expect(service.validate({ direction: 'BUY', confidenceRaw: 2 }).state).toBe('AI_INVALID');
  });

  it('keeps EV unavailable until probability is calibrated', () => {
    const service = new ExpectedValueService();
    expect(service.calculate({ winProbability: null, probabilitySource: 'CALIBRATED', expectedReward: 2, expectedLoss: 1, fee: 0.001, spread: 0.001, slippage: 0.001, funding: 0, holdingTimeMs: 1, executionQuality: 'GOOD' }).available).toBe(false);
    expect(service.calculate({ winProbability: 0.6, probabilitySource: 'CALIBRATED', expectedReward: 2, expectedLoss: 1, fee: 0.01, spread: 0.01, slippage: 0.01, funding: 0, holdingTimeMs: 1, executionQuality: 'GOOD' }).netEV).toBeCloseTo(0.77);
  });

  it('builds structure invalidation and ordered targets', () => {
    const result = new EntryExitService().calculate({
      direction: 'LONG', price: 100, spread: 0.2, atr: 2, structureInvalidation: 98,
      liquidityTargets: [103, 101], structureTargets: [106],
    });
    expect(result.stopLoss).toBeLessThan(98);
    expect(result.tp1?.price).toBe(101);
    expect(result.tp3?.price).toBe(106);
  });

  it('detects confirmed swings without using the last candle as a future pivot', () => {
    const candles = Array.from({ length: 9 }, (_, index) => ({
      timestamp: index, open: 10, high: [10, 11, 12, 15, 12, 11, 10, 11, 12][index],
      low: [9, 9, 10, 11, 10, 9, 8, 9, 10][index], close: 10, volume: 1,
    }));
    const result = new MarketStructureService().analyze('BTCUSDT', '5m', candles);
    expect(result.events.some((event) => event.type === 'SWING_HIGH')).toBe(true);
    expect(result.events.every((event) => event.timestamp <= candles.at(-1)!.timestamp)).toBe(true);
  });
});
