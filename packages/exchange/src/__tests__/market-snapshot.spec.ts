import {
  calculateBookExecution,
  calculateVolatility,
  fetchCanonicalMarketSnapshot,
} from '../services/market-snapshot.service';
import { RiskEngine } from '../services/risk-engine';

describe('canonical market snapshot', () => {
  const book = {
    symbol: 'BTCUSDT',
    bids: [['99', '1']] as [string, string][],
    asks: [['101', '1']] as [string, string][],
    timestamp: 1_000,
  };

  it('derives a consistent spread from valid bid and ask', async () => {
    const exchange: any = {
      name: 'binance',
      fetchTicker: async () => ({ symbol: 'BTCUSDT', bid: '99', ask: '101', last: '100', timestamp: 1_000 }),
      fetchOrderBook: async () => book,
      fetchRecentKlines: async () => [
        { symbol: 'BTCUSDT', close: '99', timestamp: 800 },
        { symbol: 'BTCUSDT', close: '100', timestamp: 900 },
        { symbol: 'BTCUSDT', close: '101', timestamp: 1_000 },
      ],
    };
    const snapshot = await fetchCanonicalMarketSnapshot(exchange, {
      symbol: 'BTCUSDT', side: 'BUY', quantity: 0.1, now: 1_000, maxAgeMs: 500,
    });
    expect(snapshot.mid).toBe(100);
    expect(snapshot.spread).toBe(0.02);
    expect(snapshot.stale).toBe(false);
  });

  it('rejects stale, invalid, missing, and mismatched snapshots', async () => {
    const base: any = {
      name: 'binance',
      fetchTicker: async () => ({ symbol: 'BTCUSDT', bid: '99', ask: '101', last: '100', timestamp: 0 }),
      fetchOrderBook: async () => book,
      fetchRecentKlines: async () => [
        { symbol: 'BTCUSDT', close: '99', timestamp: 0 },
        { symbol: 'BTCUSDT', close: '100', timestamp: 0 },
        { symbol: 'BTCUSDT', close: '101', timestamp: 0 },
      ],
    };
    await expect(fetchCanonicalMarketSnapshot(base, { symbol: 'BTCUSDT', side: 'BUY', quantity: 0.1, now: 20_000 })).rejects.toThrow(/stale/i);
    await expect(fetchCanonicalMarketSnapshot({
      ...base,
      fetchTicker: async () => ({ symbol: 'BTCUSDT', bid: '102', ask: '101', last: '101', timestamp: 1_000 }),
    }, { symbol: 'BTCUSDT', side: 'BUY', quantity: 0.1, now: 1_000 })).rejects.toThrow(/bid/i);
    await expect(fetchCanonicalMarketSnapshot({
      ...base,
      fetchTicker: async () => ({ symbol: 'OTHER', bid: '99', ask: '101', last: '100', timestamp: 1_000 }),
    }, { symbol: 'BTCUSDT', side: 'BUY', quantity: 0.1, now: 1_000 })).rejects.toThrow(/symbol mismatch/i);
    await expect(fetchCanonicalMarketSnapshot({
      ...base,
      fetchTicker: async () => ({ symbol: 'BTCUSDT', bid: '99', ask: '101', last: '100', timestamp: 1_000 }),
      fetchOrderBook: async () => ({ ...book, bids: [], timestamp: 1_000 }),
    }, { symbol: 'BTCUSDT', side: 'BUY', quantity: 0.1, now: 1_000 })).rejects.toThrow(/incomplete/i);
    await expect(fetchCanonicalMarketSnapshot({
      ...base,
      fetchOrderBook: async () => ({ ...book, timestamp: 50_000 }),
    }, { symbol: 'BTCUSDT', side: 'BUY', quantity: 0.1, now: 1_000 })).rejects.toThrow(/timestamps/i);
  });

  it('calculates deterministic depth slippage and rejects insufficient depth', () => {
    expect(calculateBookExecution(book, 'BUY', 0.5, 100).slippage).toBeCloseTo(0.01);
    expect(() => calculateBookExecution(book, 'BUY', 2, 100)).toThrow(/depth/i);
  });

  it('calculates deterministic volatility from a price series', () => {
    expect(calculateVolatility([
      { symbol: 'BTCUSDT', close: '100', timestamp: 1 },
      { symbol: 'BTCUSDT', close: '101', timestamp: 2 },
      { symbol: 'BTCUSDT', close: '100', timestamp: 3 },
    ], 'BTCUSDT')).toBeGreaterThan(0);
    expect(() => calculateVolatility([
      { symbol: 'BTCUSDT', close: '100', timestamp: 1 },
      { symbol: 'BTCUSDT', close: '101', timestamp: 2 },
    ], 'BTCUSDT')).toThrow(/history/i);
  });

  it('passes the authoritative snapshot into the risk market gate', async () => {
    const exchange: any = {
      name: 'binance',
      fetchTicker: async () => ({ symbol: 'BTCUSDT', bid: '99.99', ask: '100.01', last: '100', timestamp: 1_000 }),
      fetchOrderBook: async () => ({
        symbol: 'BTCUSDT',
        bids: [['99.99', '10']],
        asks: [['100.01', '10']],
        timestamp: 1_000,
      }),
      fetchRecentKlines: async () => [
        { symbol: 'BTCUSDT', close: '100', timestamp: 800 },
        { symbol: 'BTCUSDT', close: '100.01', timestamp: 900 },
        { symbol: 'BTCUSDT', close: '100', timestamp: 1_000 },
      ],
    };
    const snapshot = await fetchCanonicalMarketSnapshot(exchange, {
      symbol: 'BTCUSDT', side: 'BUY', quantity: 0.00007, now: 1_000, maxAgeMs: 500,
    });
    const decision = new RiskEngine().evaluate({
      trade: {
        decisionId: 'market-snapshot-integration',
        symbol: 'BTCUSDT',
        action: 'BUY',
        entry: 100,
        stopLoss: 99,
        takeProfit: 102,
        requestedPositionSize: 0.00007,
        riskAmount: 0.00007,
        portfolioHeatBefore: 0,
        symbolExposureBefore: 0,
        correlatedExposureBefore: 0,
        leverage: 1,
        marginRequired: 100 * 0.00007,
        estimatedFees: 0,
        estimatedSlippage: snapshot.slippage,
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
      market: snapshot,
    });
    expect(decision.approved).toBe(true);
    expect(decision.failedChecks).toEqual([]);
  });
});
