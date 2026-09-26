import assert from 'node:assert/strict';
import { StrategyEngine } from './engine';
import { MarketBar } from './types';

const engine = new StrategyEngine();
const strategy = engine.getTemplate('ema-crossover')!;
const base: MarketBar[] = [
  { timestamp: 1, open: 100, high: 101, low: 99, close: 100, volume: 10, indicators: { emaShort: 101, emaLong: 100 } },
  { timestamp: 2, open: 100, high: 103, low: 99, close: 102, volume: 10, indicators: { emaShort: 102, emaLong: 100 } },
  { timestamp: 3, open: 102, high: 110, low: 101, close: 108, volume: 10, indicators: { emaShort: 105, emaLong: 101 } },
];
const future = [...base, { timestamp: 4, open: 108, high: 150, low: 107, close: 145, volume: 999999 }];
const first = engine.backtestAudited(strategy, base, { spreadBps: 2, slippageBps: 1, feeBps: 4 });
const second = engine.backtestAudited(strategy, future, { spreadBps: 2, slippageBps: 1, feeBps: 4 });
assert.deepEqual(first.report.trades[0], second.report.trades[0]);
assert.equal(first.lookaheadFree, true);
assert.equal(first.parityChecked, true);
assert.match(first.executionPolicy, /spread, slippage, fees/);
