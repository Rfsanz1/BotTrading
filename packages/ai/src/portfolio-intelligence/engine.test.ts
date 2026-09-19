import assert from 'node:assert/strict';
import { PortfolioIntelligenceEngine } from './engine';

const engine = new PortfolioIntelligenceEngine();
const metrics = engine.analyze({
  totalValue: 100000,
  period: '1M',
  assets: [
    { symbol: 'BTC', sector: 'Digital Assets', allocation: 0.4, avgReturn: 0.12, volatility: 0.18, correlation: 0.85, trades: [{ pnl: 1000, win: true }, { pnl: -200, win: false }] },
    { symbol: 'ETH', sector: 'Digital Assets', allocation: 0.3, avgReturn: 0.07, volatility: 0.14, correlation: 0.75, trades: [{ pnl: 600, win: true }, { pnl: -150, win: false }] },
    { symbol: 'SPY', sector: 'Equities', allocation: 0.3, avgReturn: 0.04, volatility: 0.08, correlation: 0.3, trades: [{ pnl: 300, win: true }, { pnl: -100, win: false }] },
  ],
});

assert.ok(metrics.performance.sharpeRatio >= -3);
assert.ok(metrics.performance.winRate >= 0);
assert.ok(metrics.recommendations.length > 0);
assert.ok(metrics.reports.monthly.length > 0);

console.log(JSON.stringify(metrics, null, 2));
