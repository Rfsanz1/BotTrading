import { MarketIntelligenceScheduler } from '../market-intelligence.scheduler';

describe('MarketIntelligenceScheduler', () => {
  it('uses the populated registry for scheduled market sync while preserving internal timeframes', async () => {
    const sync = jest.fn().mockResolvedValue(undefined);
    const scheduler = new MarketIntelligenceScheduler(
      { sync } as never,
      {
        awaitReady: jest.fn().mockResolvedValue({ status: 'HEALTHY' }),
        list: jest.fn().mockResolvedValue([
          { symbol: 'BTCUSDT', exchange: 'binance', marketType: 'spot', enabled: true, quoteAsset: 'USDT' },
          { symbol: 'ETHUSDT', exchange: 'binance', marketType: 'spot', enabled: true, quoteAsset: 'USDT' },
        ]),
      } as never,
      { scan: jest.fn() } as never,
      { increment: jest.fn(), set: jest.fn() } as never,
      { awaitReady: jest.fn().mockResolvedValue({ status: 'READY' }) } as never,
    );

    await scheduler.syncMarketData();

    expect(sync).toHaveBeenCalledWith(['BTCUSDT', 'ETHUSDT'], ['1m', '5m', '1H']);
  });

  it('passes the populated Spot registry to the canonical scanner', async () => {
    const scan = jest.fn().mockReturnValue({
      candidates: [],
      metrics: { candidateCount: 0, noTradeCount: 2 },
    });
    const scheduler = new MarketIntelligenceScheduler(
      { sync: jest.fn() } as never,
      {
        awaitReady: jest.fn().mockResolvedValue({ status: 'HEALTHY' }),
        list: jest.fn().mockResolvedValue([
          { symbol: 'BTCUSDT', exchange: 'binance', marketType: 'spot', quoteAsset: 'USDT', enabled: true },
          { symbol: 'ETHUSDT', exchange: 'binance', marketType: 'spot', quoteAsset: 'USDT', enabled: true },
          { symbol: 'BTCUSDT', exchange: 'binance', marketType: 'futures', enabled: true },
        ]),
        health: jest.fn().mockReturnValue({
          status: 'HEALTHY', symbolCount: 2, enabledCount: 2, spotUsdtCount: 2, spotCount: 2, futuresCount: 0,
        }),
        syncSpotSymbolsFromBinance: jest.fn(),
      } as never,
      { scan } as never,
      { increment: jest.fn(), set: jest.fn() } as never,
      { awaitReady: jest.fn().mockResolvedValue({ status: 'READY', canonicalPopulated: 2, canonicalFresh: 2, canonicalStale: 0, failed: 0 }) } as never,
    );

    await scheduler.scanCanonicalUniverse();

    expect(scan).toHaveBeenCalledWith(['BTCUSDT', 'ETHUSDT'], 'spot');
  });

  it('logs and publishes non-zero registry metrics even when the scanner returns no candidates', async () => {
    const scan = jest.fn().mockReturnValue({
      candidates: [],
      metrics: { symbolsSeen: 2, symbolsEligible: 2, symbolsRejected: 0, candidateCount: 0, noTradeCount: 2 },
    });
    const metrics = { increment: jest.fn(), set: jest.fn() };
    const scheduler = new MarketIntelligenceScheduler(
      { sync: jest.fn() } as never,
      {
        awaitReady: jest.fn().mockResolvedValue({
          status: 'HEALTHY', symbolCount: 2, enabledCount: 2, spotUsdtCount: 2, spotCount: 2, futuresCount: 0,
        }),
        list: jest.fn().mockResolvedValue([
          { symbol: 'BTCUSDT', exchange: 'binance', marketType: 'spot', quoteAsset: 'USDT', enabled: true },
          { symbol: 'ETHUSDT', exchange: 'binance', marketType: 'spot', quoteAsset: 'USDT', enabled: true },
        ]),
      } as never,
      { scan } as never,
      metrics as never,
      { awaitReady: jest.fn().mockResolvedValue({ status: 'READY', canonicalPopulated: 2, canonicalFresh: 2, canonicalStale: 0, failed: 0 }) } as never,
    );

    await scheduler.scanCanonicalUniverse();

    expect(metrics.set).toHaveBeenCalledWith('registrySpotUsdt', 2);
    expect(metrics.set).toHaveBeenCalledWith('symbolsSeen', 2);
    expect(metrics.set).toHaveBeenCalledWith('symbolsEligible', 2);
    expect(scan).toHaveBeenCalledWith(['BTCUSDT', 'ETHUSDT'], 'spot');
  });

  it('blocks scanning during websocket coverage loss and resumes after recovery', async () => {
    const previous = process.env.ENABLE_BINANCE_MARKET_STREAMS;
    process.env.ENABLE_BINANCE_MARKET_STREAMS = 'true';
    const scan = jest.fn().mockReturnValue({
      candidates: [],
      metrics: { symbolsSeen: 2, symbolsEligible: 2, symbolsRejected: 0, candidateCount: 0, noTradeCount: 2 },
    });
    const marketData = {
      awaitReady: jest.fn().mockResolvedValue({ status: 'READY', canonicalPopulated: 2, canonicalFresh: 2, canonicalStale: 0, failed: 0 }),
      status: jest.fn()
        .mockReturnValueOnce({ spot: { shardCount: 2, coveragePercent: 50, streamsActive: 1, streamsRequested: 2, healthyShards: 1, eventsReceived: 4 } })
        .mockReturnValueOnce({ spot: { shardCount: 2, coveragePercent: 100, streamsActive: 2, streamsRequested: 2, healthyShards: 2, eventsReceived: 8 } }),
    };
    const metrics = { increment: jest.fn(), set: jest.fn() };
    const scheduler = new MarketIntelligenceScheduler(
      { sync: jest.fn() } as never,
      {
        awaitReady: jest.fn().mockResolvedValue({ status: 'HEALTHY' }),
        list: jest.fn().mockResolvedValue([
          { symbol: 'BTCUSDT', exchange: 'binance', marketType: 'spot', quoteAsset: 'USDT', enabled: true },
          { symbol: 'ETHUSDT', exchange: 'binance', marketType: 'spot', quoteAsset: 'USDT', enabled: true },
        ]),
      } as never,
      { scan } as never,
      metrics as never,
      marketData as never,
    );

    await scheduler.scanCanonicalUniverse();
    expect(scan).not.toHaveBeenCalled();
    await scheduler.scanCanonicalUniverse();
    expect(scan).toHaveBeenCalledWith(['BTCUSDT', 'ETHUSDT'], 'spot');
    if (previous === undefined) delete process.env.ENABLE_BINANCE_MARKET_STREAMS;
    else process.env.ENABLE_BINANCE_MARKET_STREAMS = previous;
  });
});
