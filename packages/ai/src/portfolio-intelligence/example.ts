import { PortfolioIntelligenceEngine } from './engine';

const engine = new PortfolioIntelligenceEngine();

const metrics = engine.analyze({
  totalValue: 100000,
  period: '1M',
  assets: [
    { symbol: 'BTC', sector: 'Digital Assets', allocation: 0.35, avgReturn: 0.12, volatility: 0.18, correlation: 0.82, trades: [{ pnl: 1800, win: true }, { pnl: -800, win: false }] },
    { symbol: 'ETH', sector: 'Digital Assets', allocation: 0.2, avgReturn: 0.08, volatility: 0.15, correlation: 0.78, trades: [{ pnl: 900, win: true }, { pnl: -300, win: false }] },
    { symbol: 'SPY', sector: 'Equities', allocation: 0.25, avgReturn: 0.04, volatility: 0.08, correlation: 0.35, trades: [{ pnl: 500, win: true }, { pnl: -100, win: false }] },
    { symbol: 'TLT', sector: 'Bonds', allocation: 0.2, avgReturn: 0.02, volatility: 0.04, correlation: 0.12, trades: [{ pnl: 240, win: true }, { pnl: -50, win: false }] },
  ],
});

const dashboard = engine.buildDashboard(metrics);

console.log(JSON.stringify({ metrics, dashboard }, null, 2));
