import { RiskEngine, RiskEvaluationInput, resolveTradeIntent } from '../services/risk-engine';

describe('RiskEngine', () => {
  const engine = new RiskEngine();

  const baseInput = (): RiskEvaluationInput => ({
    trade: {
      decisionId: 'd-1',
      symbol: 'BTCUSDT',
      action: 'BUY',
      entry: 100,
      stopLoss: 96,
      takeProfit: 110,
      requestedPositionSize: 1,
      riskAmount: 4,
      portfolioHeatBefore: 0.01,
      symbolExposureBefore: 0.01,
      correlatedExposureBefore: 0.02,
      leverage: 1,
      marginRequired: 10,
      estimatedFees: 0.12,
      estimatedSlippage: 0.02,
      dailyPnL: -20,
      dailyLossLimit: 100,
      drawdown: 0.04,
      riskVersion: 'risk-test-v1',
    },
    account: {
      totalEquity: 1000,
      availableBalance: 900,
      marginUsed: 50,
      freeMargin: 950,
      unrealizedPnL: 0,
      realizedPnL: -20,
      leverage: 1,
      peakEquity: 1100,
      currentDrawdown: 0.04,
      dailyPnL: -20,
      weeklyPnL: -50,
      consecutiveLosses: 2,
      tradingEnabled: true,
      killSwitch: false,
    },
    positions: [{ symbol: 'BTCUSDT', side: 'long', quantity: 0.5, entryPrice: 99, notional: 49.5, exposure: 0.05 }],
    market: {
      spread: 0.0008,
      liquidity: 0.9,
      slippage: 0.002,
      stale: false,
      volatility: 0.4,
      correlationCluster: 'crypto-major',
      clusterExposure: 0.08,
      correlation: 0.8,
    },
  });

  it('approves a normal trade with valid checks', () => {
    const decision = engine.evaluate(baseInput());
    expect(decision.approved).toBe(true);
    expect(decision.failedChecks).toEqual([]);
  });

  it('rejects when max risk per trade is exceeded', () => {
    const input = baseInput();
    input.trade.riskAmount = 100;
    input.trade.requestedPositionSize = 25;
    const decision = engine.evaluate(input);
    expect(decision.approved).toBe(false);
    expect(decision.failedChecks).toContain('MAX_RISK_PER_TRADE');
  });

  it('rejects when daily loss threshold is reached', () => {
    const input = baseInput();
    input.account.dailyPnL = -1000;
    const decision = engine.evaluate(input);
    expect(decision.approved).toBe(false);
    expect(decision.failedChecks).toContain('DAILY_LOSS_LIMIT');
  });

  it('rejects stale market data', () => {
    const input = baseInput();
    input.market.stale = true;
    const decision = engine.evaluate(input);
    expect(decision.approved).toBe(false);
    expect(decision.failedChecks).toContain('MARKET_FRESHNESS');
  });

  it('rejects when portfolio heat would exceed the limit', () => {
    const input = baseInput();
    input.trade.portfolioHeatBefore = 0.046;
    const decision = engine.evaluate(input);
    expect(decision.approved).toBe(false);
    expect(decision.failedChecks).toContain('MAX_PORTFOLIO_HEAT');
  });

  it.each([
    ['BUY', undefined, 1, 'ENTRY'],
    ['SELL', undefined, 1, 'ENTRY'],
    ['SELL', { side: 'BUY', quantity: 1 }, 1, 'CLOSE'],
    ['SELL', { side: 'BUY', quantity: 1 }, 0.4, 'REDUCE'],
    ['BUY', { side: 'SELL', quantity: 1 }, 1, 'CLOSE'],
    ['BUY', { side: 'SELL', quantity: 1 }, 0.4, 'REDUCE'],
    ['SELL', { side: 'BUY', quantity: 1 }, 1.1, 'REVERSAL'],
    ['BUY', { side: 'SELL', quantity: 1 }, 1.1, 'REVERSAL'],
  ] as const)('resolves %s against %s position as %s', (side, position, quantity, expected) => {
    expect(resolveTradeIntent(side as 'BUY' | 'SELL', position, quantity)).toBe(expected);
  });

  it('does not apply entry TP direction validation to a close', () => {
    const input = baseInput();
    input.trade.action = 'SELL';
    input.trade.intent = 'CLOSE';
    input.trade.entry = 100;
    input.trade.stopLoss = 104;
    input.trade.takeProfit = 99;
    const decision = engine.evaluate(input);
    expect(decision.failedChecks).not.toContain('TAKE_PROFIT_VALIDATION');
  });

  it('requires direction-sensitive levels for BUY and SELL entries', () => {
    const buy = baseInput();
    expect(engine.evaluate(buy).failedChecks).not.toContain('TAKE_PROFIT_VALIDATION');

    const invalidBuy = baseInput();
    invalidBuy.trade.stopLoss = 101;
    expect(engine.evaluate(invalidBuy).failedChecks).toContain('TAKE_PROFIT_VALIDATION');

    const sell = baseInput();
    sell.trade.action = 'SELL';
    sell.trade.stopLoss = 104;
    sell.trade.takeProfit = 90;
    expect(engine.evaluate(sell).failedChecks).not.toContain('TAKE_PROFIT_VALIDATION');

    const invalidSell = baseInput();
    invalidSell.trade.action = 'SELL';
    invalidSell.trade.stopLoss = 96;
    invalidSell.trade.takeProfit = 110;
    expect(engine.evaluate(invalidSell).failedChecks).toContain('TAKE_PROFIT_VALIDATION');
  });

  it('keeps close and reversal semantics explicit', () => {
    const close = baseInput();
    close.trade.action = 'SELL';
    close.trade.intent = 'CLOSE';
    close.trade.stopLoss = 104;
    close.trade.takeProfit = 90;
    expect(engine.evaluate(close).failedChecks).not.toContain('TAKE_PROFIT_VALIDATION');

    const reversal = baseInput();
    reversal.trade.action = 'SELL';
    reversal.trade.intent = 'REVERSAL';
    expect(resolveTradeIntent('SELL', { side: 'BUY', quantity: 1 }, 1.1)).toBe('REVERSAL');
  });
});
