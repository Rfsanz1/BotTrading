import assert from 'node:assert/strict';
import { StrategyEngine } from './engine';

const engine = new StrategyEngine();
const template = engine.getTemplate('ema-crossover');

assert.ok(template, 'Expected the EMA crossover template to be registered');

const evaluation = engine.evaluateStrategy(template!, {
  symbol: 'BTCUSDT',
  price: 65000,
  ema: { short: 65, long: 60 },
  macd: { line: 0.8, signal: 0.2 },
  rsi: 62,
});

assert.ok(['BUY', 'SELL', 'HOLD'].includes(evaluation.action));
assert.ok(evaluation.confidence >= 0 && evaluation.confidence <= 1);
assert.ok(evaluation.reasons.length > 0);

const combined = engine.composeStrategies([template!], {
  symbol: 'BTCUSDT',
  price: 65000,
  ema: { short: 65, long: 60 },
  macd: { line: 0.8, signal: 0.2 },
  rsi: 62,
});

assert.ok(['BUY', 'SELL', 'HOLD'].includes(combined.action));

console.log(JSON.stringify({ evaluation, combined }, null, 2));
