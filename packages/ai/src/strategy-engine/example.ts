import { StrategyEngine } from './engine';

const engine = new StrategyEngine();
const template = engine.getTemplate('macd-trend');

if (!template) {
  throw new Error('Template not found');
}

const signal = engine.evaluateStrategy(template, {
  symbol: 'BTCUSDT',
  price: 65000,
  previousClose: 64000,
  macd: { line: 1.2, signal: 0.3, histogram: 0.9 },
  rsi: 62,
  marketBias: 'bullish',
});

console.log(JSON.stringify(signal, null, 2));

const combined = engine.composeStrategies([template], {
  symbol: 'BTCUSDT',
  price: 65200,
  previousClose: 64800,
  macd: { line: 1.6, signal: 0.5, histogram: 1.1 },
  rsi: 68,
  smc: { orderBlock: true, fairValueGap: true, liquiditySweep: false },
  volumeProfile: { bias: 'buy' },
  priceAction: { breakout: true },
} as any);

console.log(JSON.stringify(combined, null, 2));
