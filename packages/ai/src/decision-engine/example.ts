import { TradingDecisionEngine } from './engine';

const engine = new TradingDecisionEngine();

const output = engine.evaluate({
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
    reasons: ['Momentum is improving', 'Sentiment is positive'],
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

console.log(JSON.stringify(output, null, 2));
