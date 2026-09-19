import assert from 'node:assert/strict';
import { TradingDecisionEngine } from './engine';

const engine = new TradingDecisionEngine();

const result = engine.evaluate({
  marketData: {
    symbol: 'BTCUSDT',
    price: 65000,
    changePercent: 1.8,
    volume: 1200000,
  },
  aiConsensus: {
    recommendation: 'BUY',
    confidence: 0.74,
    agreementScore: 0.81,
    reasons: ['Momentum improving'],
  },
  technical: {
    rsi: 61,
    macd: 0.8,
    ma20: 65200,
    ma50: 64000,
    atr: 900,
    volatility: 0.025,
  },
  news: {
    score: 0.35,
    sentiment: 'positive',
    impact: 'medium',
  },
  alerts: [{ type: 'buy', confidence: 0.7, message: 'Breakout above resistance' }],
  portfolio: {
    currentWeight: 0.08,
    concentrationRisk: 0.12,
    totalValue: 100000,
    openPositions: [{ symbol: 'BTCUSDT', size: 0.5 }],
  },
  riskSettings: {
    maxPositionSizePct: 0.05,
    maxDrawdownPct: 0.12,
    maxRiskPct: 0.01,
    riskRewardMin: 2,
    confidenceThreshold: 0.6,
  },
});

assert.ok(['BUY', 'SELL', 'HOLD'].includes(result.action));
assert.ok(result.buyScore >= 0 && result.buyScore <= 1);
assert.ok(result.sellScore >= 0 && result.sellScore <= 1);
assert.ok(result.holdScore >= 0 && result.holdScore <= 1);
assert.ok(result.confidence >= 0 && result.confidence <= 1);
assert.ok(result.positionSize > 0);
assert.ok(result.explanation.length > 0);
assert.ok(result.reasons.length > 0);

console.log(JSON.stringify(result, null, 2));
