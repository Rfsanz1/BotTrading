import { EventEmitter2 } from '@nestjs/event-emitter';
import { CanonicalMarketCacheService } from '../services/canonical-market-cache.service';
import { DataQualityService } from '../services/data-quality.service';
import { LiquidationService } from '../services/liquidation.service';
import { MarketStreamEventRouterService } from '../services/market-stream-event-router.service';
import { TradeFlowService } from '../services/trade-flow.service';

describe('market stream canonical pipeline', () => {
  it('routes kline, trade, ticker, depth, and futures events into one state', () => {
    const events = new EventEmitter2();
    const cache = new CanonicalMarketCacheService(new TradeFlowService(), new DataQualityService(), events, new LiquidationService());
    const router = new MarketStreamEventRouterService(cache);
    router.initializeOrderBook('spot', 'BTCUSDT', { lastUpdateId: 10, bids: [[100, 2]], asks: [[101, 2]] });
    router.route('spot', { e: 'bookTicker', s: 'BTCUSDT', E: 1_000, b: '100', a: '101' });
    router.route('spot', { e: 'depthUpdate', s: 'BTCUSDT', E: 1_001, U: 11, u: 11, pu: 10, b: [['100', '3']], a: [] });
    router.route('spot', { e: 'aggTrade', s: 'BTCUSDT', E: 1_002, p: '100.5', q: '2', m: false });
    router.route('spot', { e: 'kline', s: 'BTCUSDT', E: 1_003, k: { i: '1m', t: 0, T: 59_999, o: '100', h: '101', l: '99', c: '100.5', v: '10', x: true } });
    const state = cache.get('BTCUSDT', 'spot')!;
    expect(state.lastPrice).toBe(100.5);
    expect(state.orderBook?.sequenceHealthy).toBe(true);
    expect(state.tradeFlow.takerDelta).toBe(2);
    expect(state.candles['1m']).toHaveLength(1);
  });

  it('marks invalid order book sequences without fabricating a valid book', () => {
    const cache = new CanonicalMarketCacheService(new TradeFlowService(), new DataQualityService(), new EventEmitter2(), new LiquidationService());
    const router = new MarketStreamEventRouterService(cache);
    router.initializeOrderBook('futures', 'ETHUSDT', { lastUpdateId: 5, bids: [[100, 1]], asks: [[101, 1]] });
    router.route('futures', { e: 'depthUpdate', s: 'ETHUSDT', E: 2_000, U: 8, u: 8, pu: 5, b: [], a: [] });
    const state = cache.get('ETHUSDT', 'futures')!;
    expect(state.orderBook?.sequenceHealthy).toBe(false);
    expect(state.dataQuality.state).toBe('INVALID');
  });

  it('reconciles candle backfill without duplicates and hydrates futures statistics', () => {
    const cache = new CanonicalMarketCacheService(new TradeFlowService(), new DataQualityService(), new EventEmitter2(), new LiquidationService());
    cache.backfillCandles('BTCUSDT', 'futures', '1m', [
      { openTime: 0, closeTime: 59_999, open: 100, high: 101, low: 99, close: 100.5, volume: 10, closed: true },
      { openTime: 60_000, closeTime: 119_999, open: 100.5, high: 102, low: 100, close: 101.5, volume: 12, closed: true },
    ]);
    cache.backfillCandles('BTCUSDT', 'futures', '1m', [
      { openTime: 60_000, closeTime: 119_999, open: 100.5, high: 102, low: 100, close: 101.5, volume: 12, closed: true },
    ]);
    const state = cache.hydrateFutures('BTCUSDT', {
      currentFundingRate: 0.001,
      fundingHistory: [0.0005, 0.0008, 0.0009],
      currentOpenInterest: 110,
      openInterestHistory: [90, 100],
      lastPrice: 101.5,
      markPrice: 101.4,
      indexPrice: 101,
    });
    expect(state.candles['1m']).toHaveLength(2);
    expect(state.futures.fundingZScore).not.toBeNull();
    expect(state.futures.openInterestDelta).toBe(10);
    expect(state.futures.basis).toBeCloseTo(0.5);
  });
});
