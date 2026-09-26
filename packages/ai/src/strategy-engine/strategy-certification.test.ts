import assert from 'node:assert/strict';
import { StrategyEngine } from './engine';
import { MarketBar } from './types';

const bars: MarketBar[] = Array.from({ length: 40 }, (_, index) => {
  const close = 100 + index * 0.5 + (index % 4 === 0 ? 1 : 0);
  return {
    timestamp: index + 1,
    open: close - 0.25,
    high: close + 1,
    low: close - 1,
    close,
    volume: 100 + index,
    indicators: {
      ema: { short: close + 1, long: close },
      rsi: 25,
      macd: { line: 1, signal: 0 },
      bollinger: { upper: close + 2, middle: close, lower: close - 2 },
      adx: 30,
      superTrend: { direction: 'up', value: close - 1 },
      priceAction: { trend: 'up', breakout: true, retest: true },
      volumeProfile: { bias: 'buy', valueAreaHigh: close + 1, valueAreaLow: close - 1, poc: close },
      smc: { structure: 'bullish', orderBlock: true, fairValueGap: true, liquiditySweep: true },
      ict: { orderBlock: true, fairValueGap: true, liquiditySweep: true },
      wyckoff: { phase: 'accumulation', accumulation: true },
      fairValueGap: { bullish: true, strength: 1 },
      liquiditySweep: true,
      breakerBlock: { bullish: true },
      mitigationBlock: { bullish: true },
    },
  };
});

const engine = new StrategyEngine();
const config = { spreadBps: 2, slippageBps: 1, feeBps: 4, fundingBpsPerBar: 1 };
const future = [...bars, { ...bars[bars.length - 1], timestamp: 41, close: 1000, high: 1100, volume: 999999 }];

for (const strategy of engine.listTemplates()) {
  const report = engine.backtestAudited(strategy, bars, config);
  const extended = engine.backtestAudited(strategy, future, config);
  assert.equal(report.lookaheadFree, true, strategy.id);
  assert.equal(report.parityChecked, true, strategy.id);
  assert.match(report.executionPolicy, /spread, slippage, fees, and funding/, strategy.id);
  assert.deepEqual(report.report.trades[0], extended.report.trades[0], strategy.id);
  assert.ok(report.report.totalTrades >= 0);
  assert.ok(report.report.maxDrawdown >= 0);
  const walkForward = engine.walkForwardAudited(strategy, bars, config, 2);
  assert.equal(walkForward.lookaheadFree, true, strategy.id);
  assert.equal(walkForward.testDataUsedForSelection, false, strategy.id);
}

assert.equal(engine.resolveIntrabarExit('BUY', { high: 105, low: 99 }, 99, 105), 'STOP_LOSS');
assert.equal(engine.resolveIntrabarExit('BUY', { high: 105, low: 101 }, 99, 105), 'TAKE_PROFIT');
assert.equal(engine.resolveIntrabarExit('BUY', { high: 105, low: 99 }, 99, 105), 'STOP_LOSS');
assert.equal(engine.resolveIntrabarExit('BUY', { high: 102, low: 100 }, 99, 105), 'NONE');
assert.equal(engine.resolveIntrabarExit('SELL', { high: 105, low: 95 }, 105, 95), 'STOP_LOSS');

const conservative = {
  ...engine.getTemplate('ema-crossover')!,
  id: 'cert-conservative',
  riskManagement: [
    { type: 'stop_loss' as const, threshold: 0.02, action: 'stop' },
    { type: 'take_profit' as const, threshold: 0.04, action: 'target' },
  ],
  rules: [{ condition: 'EMA_SHORT > EMA_LONG', action: 'BUY' as const, weight: 1 }],
};
const intrabarReport = engine.backtestAudited(conservative, [
  { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 1, indicators: { ema: { short: 101, long: 100 } } },
  { timestamp: 2, open: 100, high: 110, low: 90, close: 105, volume: 1, indicators: { ema: { short: 101, long: 100 } } },
], config);
assert.equal(intrabarReport.report.trades[0]?.exitPrice < intrabarReport.report.trades[0]?.entryPrice, true);
