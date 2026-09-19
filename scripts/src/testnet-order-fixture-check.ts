import { strict as assert } from 'node:assert';
import { RiskEngine } from '@rfsanz/exchange';
import { buildRiskValidLevels } from './testnet-order-fixture-logic.ts';

const entry = 78_000;
const levels = buildRiskValidLevels(entry);
const decision = new RiskEngine().evaluate({
  trade: {
    decisionId: 'fixture-risk-check',
    symbol: 'BTCUSDT',
    action: 'BUY',
    entry,
    stopLoss: levels.stopLoss,
    takeProfit: levels.targetPrice,
    requestedPositionSize: 0.00007,
    riskAmount: 0.00007,
    portfolioHeatBefore: 0,
    symbolExposureBefore: 0,
    correlatedExposureBefore: 0,
    leverage: 1,
    marginRequired: entry * 0.00007,
    estimatedFees: 0,
    estimatedSlippage: 0,
    dailyPnL: 0,
    dailyLossLimit: 1000,
    drawdown: 0,
  },
  account: {
    totalEquity: 10_000,
    availableBalance: 10_000,
    marginUsed: 0,
    freeMargin: 10_000,
    unrealizedPnL: 0,
    realizedPnL: 0,
    leverage: 1,
    peakEquity: 10_000,
    currentDrawdown: 0,
    dailyPnL: 0,
    weeklyPnL: 0,
    consecutiveLosses: 0,
    tradingEnabled: true,
    killSwitch: false,
  },
  positions: [],
  market: {
    spread: 0,
    liquidity: 0.9,
    slippage: 0,
    stale: false,
    volatility: 0,
  },
});

assert.equal(decision.approved, true, decision.reason);
assert.equal(decision.failedChecks.length, 0, decision.failedChecks.join(','));
console.log(`PASS TESTNET fixture risk: RR=${((levels.targetPrice - entry) / (entry - levels.stopLoss)).toFixed(4)}`);
