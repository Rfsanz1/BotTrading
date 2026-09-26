import { AiValidationService } from '../services/ai-validation.service';
import { EntryExitService } from '../services/entry-exit.service';
import { ExpectedValueService } from '../services/expected-value.service';
import { MarketStructureService } from '../services/market-structure.service';
import { MultiTimeframeService } from '../services/multi-timeframe.service';
import { OpportunityService } from '../services/opportunity.service';
import { RegimeService } from '../services/regime.service';
import { TradingDecisionPipelineService } from '../services/trading-decision-pipeline.service';
import { PaperTradingService } from '../services/paper-trading.service';
import { CanonicalMarketState } from '../interfaces/canonical-market.interface';

function state(): CanonicalMarketState {
  const features = {
    trend: 'BULLISH' as const,
    momentum: 0.01,
    volatility: 0.002,
    structure: 'BULLISH' as const,
    volume: 100,
    updatedAt: Date.now(),
  };
  return {
    symbol: 'BTCUSDT',
    marketType: 'futures',
    lastPrice: 100,
    bid: 99.9,
    ask: 100.1,
    mid: 100,
    candles: { '1m': [], '5m': [], '15m': [], '1h': [], '4h': [], '1d': [] },
    formingCandles: {},
    orderBook: {
      bestBid: 99.9, bestAsk: 100.1, midPrice: 100, spread: 0.2, spreadBps: 20,
      bidDepth5: 10000, askDepth5: 10000, bidDepth10: 10000, askDepth10: 10000,
      bidDepth20: 10000, askDepth20: 10000, imbalance5: 0.4, imbalance10: 0.4, imbalance20: 0.4,
      microPrice: 100, weightedMidPrice: 100, bidWall: null, askWall: null,
      estimatedBuySlippage: 0, estimatedSellSlippage: 0, lastUpdateId: 10, lastEventTime: Date.now(),
      dataAgeMs: 0, sequenceHealthy: true,
    },
    tradeFlow: {
      tradeCount: 10, buyVolume: 100, sellVolume: 50, takerDelta: 50, takerBuySellRatio: 2, cvd: 50,
      cvdByWindow: { '1m': 50, '5m': 50, '15m': 50, '1h': 50 }, cvdSlope: 1, cvdAcceleration: 0,
      largeTradeCount: 0, largeTradeVolume: 0, priceCvdDivergence: 'NONE', volumeCvdDivergence: 'NONE',
      oiCvdDivergence: 'NONE', updatedAt: Date.now(),
    },
    futures: {
      markPrice: 100, indexPrice: 99.8, lastPrice: 100, basis: 0.2, basisPct: 0.002,
      fundingRate: 0.0001, fundingHistory: [0.00005, 0.00008], fundingMean: 0.00008, fundingStd: 0.00002,
      fundingZScore: 1, fundingPercentile: 1, openInterestContracts: 1000, openInterestHistory: [900, 950],
      openInterestDelta: 50, openInterestPctChange: 0.05, openInterestZScore: 1, openInterestPercentile: 1, lastUpdateAt: Date.now(),
    },
    liquidation: { buyVolume: 0, sellVolume: 0, totalVolume: 0, imbalance: 0, level: 'LIQUIDATION_NORMAL', zScore: 0, lastLiquidationTime: null },
    structure: {
      '5m': { trend: 'BULLISH', protectedHigh: 105, protectedLow: 98, events: [] },
    },
    timeframes: { '1d': features, '4h': features, '1h': features, '15m': features, '5m': features, '1m': features },
    dataQuality: { state: 'HEALTHY', reasons: [], ageMs: 0 },
    lastUpdate: Date.now(),
    lastEventType: 'TEST',
  };
}

function pipeline(): TradingDecisionPipelineService {
  return new TradingDecisionPipelineService(
    new MultiTimeframeService(),
    new RegimeService(),
    new OpportunityService(),
    new MarketStructureService(),
    new AiValidationService(),
    new ExpectedValueService(),
    new EntryExitService(),
  );
}

const validAi = {
  direction: 'LONG',
  setupType: 'BREAKOUT',
  confidenceRaw: 0.8,
  supportingFactors: ['aligned structure'],
  conflictingFactors: [],
  riskWarnings: [],
  invalidation: 'below protected low',
  rationale: 'structured test response',
};

describe('final paper pipeline', () => {
  it('stops safely when calibrated probability is unavailable', () => {
    const result = pipeline().evaluate(state(), { aiOutput: validAi, equity: 10_000 });
    expect(result.finalStatus).toBe('NO_TRADE');
    expect(result.calibratedProbability).toBeNull();
    expect(result.expectedValue.available).toBe(false);
    expect(result.reasons).toContain('CALIBRATED_PROBABILITY_UNAVAILABLE');
  });

  it('authorizes only after AI, probability, EV, entry/SL/TP, and risk pass', () => {
    const result = pipeline().evaluate(state(), { aiOutput: validAi, calibratedProbability: 0.8, equity: 10_000 });
    expect(result.finalStatus).toBe('AUTHORIZED_FOR_PAPER');
    expect(result.entry?.stopLoss).toBeLessThan(result.entry?.preferredEntry ?? 0);
    expect(result.expectedValue.netEV).toBeGreaterThan(0);
    const paper = new PaperTradingService();
    const order = paper.authorize(result);
    expect(order.status).toBe('AUTHORIZED');
    paper.fill(order.id, { bid: 99.9, ask: 100.1, slippage: 0.01, feeRate: 0.0004, timestamp: order.decisionAt + 1 });
    expect(paper.mark(order.id, { bid: 105, ask: 105.1, timestamp: order.decisionAt + 2 }).status).toBe('CLOSED');
  });

  it('hard-gates stale or invalid order-book state before AI', () => {
    const invalid = state();
    invalid.dataQuality = { state: 'INVALID', reasons: ['STALE'], ageMs: 100_000 };
    invalid.orderBook!.sequenceHealthy = false;
    const result = pipeline().evaluate(invalid, { aiOutput: validAi, calibratedProbability: 0.8, equity: 10_000 });
    expect(result.finalStatus).toBe('NO_TRADE');
    expect(result.reasons[0]).toBe('DATA_INVALID');
    expect(result.aiValidation).toBeNull();
  });

  it('uses a conservative stop rule when TP and SL are both touched in one candle', () => {
    const result = pipeline().evaluate(state(), { aiOutput: validAi, calibratedProbability: 0.8, equity: 10_000 });
    const paper = new PaperTradingService();
    const order = paper.authorize(result);
    const fillAt = order.decisionAt + 1;
    paper.fill(order.id, { bid: 99.9, ask: 100.1, slippage: 0, timestamp: fillAt });
    const closed = paper.mark(order.id, {
      bid: order.entry,
      ask: order.entry,
      high: order.tp1 + 1,
      low: order.stopLoss - 1,
      timestamp: fillAt + 1,
    });
    expect(closed.status).toBe('CLOSED');
    expect(closed.exitReason).toBe('STOP_LOSS');
  });

  it('rejects decision-time fills and ignores replayed market timestamps', () => {
    const result = pipeline().evaluate(state(), { aiOutput: validAi, calibratedProbability: 0.8, equity: 10_000 });
    const paper = new PaperTradingService();
    const order = paper.authorize(result);
    expect(() => paper.fill(order.id, { bid: 99.9, ask: 100.1, slippage: 0, timestamp: order.decisionAt })).toThrow('after decision timestamp');
    const fillAt = order.decisionAt + 1;
    paper.fill(order.id, { bid: 99.9, ask: 100.1, slippage: 0, timestamp: fillAt });
    paper.mark(order.id, { bid: order.entry, ask: order.entry, timestamp: fillAt + 1 });
    const replay = paper.mark(order.id, { bid: order.tp1 + 10, ask: order.tp1 + 10, timestamp: fillAt + 1 });
    expect(replay.status).toBe('FILLED');
  });

  it('accounts for entry and exit fees and slippage as net, not gross, PnL', () => {
    const result = pipeline().evaluate(state(), { aiOutput: validAi, calibratedProbability: 0.8, equity: 10_000 });
    const paper = new PaperTradingService();
    const order = paper.authorize(result);
    const fillAt = order.decisionAt + 1;
    paper.fill(order.id, { bid: 99.9, ask: 100.1, slippage: 0.05, feeRate: 0.001, timestamp: fillAt });
    const closed = paper.mark(order.id, {
      bid: order.tp1,
      ask: order.tp1,
      timestamp: fillAt + 1,
      slippage: 0.05,
      feeRate: 0.001,
    });
    expect(closed.status).toBe('CLOSED');
    expect(closed.grossPnL).toBeGreaterThan(closed.realizedPnL);
    expect(closed.fees).toBeGreaterThan(0);
    expect(closed.slippage).toBeGreaterThan(0);
  });

  it('resolves an open paper trade as TIMEOUT without using a future decision feature', () => {
    const result = pipeline().evaluate(state(), { aiOutput: validAi, calibratedProbability: 0.8, equity: 10_000 });
    const paper = new PaperTradingService();
    const order = paper.authorize(result);
    const fillAt = order.decisionAt + 1;
    paper.fill(order.id, { bid: 99.9, ask: 100.1, slippage: 0, timestamp: fillAt });
    const closed = paper.mark(order.id, {
      bid: order.entry,
      ask: order.entry,
      timestamp: order.timeoutAt! + 1,
    });
    expect(closed.exitReason).toBe('TIMEOUT');
    expect(closed.closedAt).toBe(order.timeoutAt! + 1);
  });

  it('supports an explicit PAPER-only calibration cold start without claiming normal calibration', () => {
    const previousEnabled = process.env.PAPER_COLD_START_ENABLED;
    const previousPrior = process.env.PAPER_COLD_START_PRIOR;
    const previousMode = process.env.TRADING_MODE;
    process.env.TRADING_MODE = 'PAPER';
    process.env.PAPER_COLD_START_ENABLED = 'true';
    process.env.PAPER_COLD_START_PRIOR = '0.8';
    const result = pipeline().evaluate(state(), { aiOutput: validAi, calibratedProbability: null, equity: 10_000 });
    expect(result.calibrationState).toBe('COLD_START');
    expect(result.calibratedProbability).toBeNull();
    expect(result.finalStatus).toBe('AUTHORIZED_FOR_PAPER');
    if (previousEnabled === undefined) delete process.env.PAPER_COLD_START_ENABLED;
    else process.env.PAPER_COLD_START_ENABLED = previousEnabled;
    if (previousPrior === undefined) delete process.env.PAPER_COLD_START_PRIOR;
    else process.env.PAPER_COLD_START_PRIOR = previousPrior;
    if (previousMode === undefined) delete process.env.TRADING_MODE;
    else process.env.TRADING_MODE = previousMode;
  });
});
