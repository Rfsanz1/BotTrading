import { EventEmitter2 } from '@nestjs/event-emitter';
import { BinanceMarketDataService } from '../services/binance-market-data.service';
import { BinanceMarketClient } from '../collectors/binance-market-client';
import { CanonicalMarketCacheService } from '../services/canonical-market-cache.service';
import { DataQualityService } from '../services/data-quality.service';
import { LiquidationService } from '../services/liquidation.service';
import { MarketStreamEventRouterService } from '../services/market-stream-event-router.service';
import { TradeFlowService } from '../services/trade-flow.service';
import { BinanceShardManagerService } from '../services/binance-shard-manager.service';

function clientMock(failSymbol?: string): BinanceMarketClient {
  const now = Date.now();
  return {
    orderBook: jest.fn().mockImplementation(async (symbol: string) => {
      if (symbol === failSymbol) throw new Error('orderbook unavailable');
      return { lastUpdateId: 10, bids: [[100, 2]], asks: [[101, 2]] };
    }),
    klines: jest.fn().mockResolvedValue([
      { openTime: now - 120_000, open: 100, high: 101, low: 99, close: 100.5, volume: 10, closeTime: now - 60_001, quoteVolume: 1000, tradeCount: 10, takerBuyBaseVolume: 5, takerBuyQuoteVolume: 500 },
      { openTime: now - 60_000, open: 100.5, high: 102, low: 100, close: 101.5, volume: 12, closeTime: now - 1_000, quoteVolume: 1200, tradeCount: 10, takerBuyBaseVolume: 6, takerBuyQuoteVolume: 600 },
    ]),
  } as unknown as BinanceMarketClient;
}

function service(client: BinanceMarketClient, entries: Array<{ symbol: string }>) {
  const events = new EventEmitter2();
  const cache = new CanonicalMarketCacheService(new TradeFlowService(), new DataQualityService(), events, new LiquidationService());
  const registry = { awaitReady: jest.fn().mockResolvedValue({ status: 'HEALTHY' }), list: jest.fn().mockResolvedValue(entries.map((entry) => ({
    ...entry, exchange: 'binance', marketType: 'spot', quoteAsset: 'USDT', enabled: true,
  }))) };
  const metrics = { increment: jest.fn(), set: jest.fn() };
  const data = new BinanceMarketDataService(
    new MarketStreamEventRouterService(cache),
    client,
    cache,
    registry as never,
    metrics as never,
    new BinanceShardManagerService(),
  );
  return { data, cache, metrics };
}

describe('BinanceMarketDataService Spot bootstrap', () => {
  it('hydrates orderbook and all scanner timeframes into canonical state', async () => {
    const { data, cache } = service(clientMock(), [{ symbol: 'BTCUSDT' }]);

    await data.onModuleInit();

    const health = await data.awaitReady();
    const state = cache.get('BTCUSDT', 'spot');
    expect(health).toMatchObject({
      status: 'READY', requested: 1, succeeded: 1, failed: 0,
      candlesHydrated: 6, orderbooksHydrated: 1, canonicalPopulated: 1, canonicalFresh: 1,
    });
    expect(state?.orderBook?.sequenceHealthy).toBe(true);
    expect(state?.candles['1m']).toHaveLength(2);
    expect(state?.candles['5m']).toHaveLength(2);
  });

  it('reports partial hydration without fabricating failed symbols as canonical-ready', async () => {
    const { data, cache } = service(clientMock('ETHUSDT'), [{ symbol: 'BTCUSDT' }, { symbol: 'ETHUSDT' }]);

    await data.onModuleInit();

    const health = await data.awaitReady();
    expect(health).toMatchObject({ status: 'DEGRADED', requested: 2, succeeded: 1, failed: 1, canonicalPopulated: 1 });
    expect(cache.get('BTCUSDT', 'spot')?.orderBook?.sequenceHealthy).toBe(true);
    expect(cache.get('ETHUSDT', 'spot')).toBeUndefined();
  });
});
