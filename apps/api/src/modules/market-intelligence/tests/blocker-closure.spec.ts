import { BinanceShardManagerService, partitionBinanceStreams } from '../services/binance-shard-manager.service';
import { MarketObservabilityService } from '../services/market-observability.service';
import { RecoverySchedulerService } from '../services/recovery-scheduler.service';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BinanceStreamManager } from '../services/binance-stream.manager';
import { LocalOrderBookEngine } from '../services/local-order-book.engine';
import { MarketIntelligenceScheduler } from '../market-intelligence.scheduler';
import { UniverseScannerService } from '../services/universe-scanner.service';
import * as promClient from 'prom-client';

describe('blocker closure infrastructure', () => {
  it('partitions configured symbols without duplicate shard ownership', () => {
    const manager = new BinanceShardManagerService();
    manager.createShards('spot', ['BTCUSDT', 'ETHUSDT', 'BTCUSDT', 'SOLUSDT'], 2);
    expect(manager.statuses()).toHaveLength(2);
    expect(manager.shardFor('BTCUSDT')).toBe(1);
    expect(manager.shardFor('SOLUSDT')).toBe(2);
    const symbols = manager.statuses().flatMap((status) => status.symbols);
    expect(new Set(symbols).size).toBe(symbols.length);
  });

  it('partitions every registry stream deterministically within count and URL bounds', () => {
    const streams = Array.from({ length: 494 }, (_, index) => {
      const symbol = `ASSET${String(index).padStart(3, '0')}USDT`;
      return [`${symbol}@aggTrade`, `${symbol}@bookTicker`, `${symbol}@kline_1m`, `${symbol}@kline_5m`, `${symbol}@depth@100ms`];
    }).flat();
    const first = partitionBinanceStreams(streams, { maxStreamsPerShard: 80, maxUrlBytes: 6_000, maxShards: 64 });
    const second = partitionBinanceStreams(streams, { maxStreamsPerShard: 80, maxUrlBytes: 6_000, maxShards: 64 });
    expect(first).toEqual(second);
    expect(first).toHaveLength(31);
    expect(first.flat()).toHaveLength(2470);
    expect(new Set(first.flat()).size).toBe(2470);
    for (const shard of first) {
      expect(shard.length).toBeLessThanOrEqual(80);
      expect(Buffer.byteLength(`wss://stream.binance.com:9443/stream?streams=${shard.join('/')}`, 'utf8')).toBeLessThanOrEqual(6_000);
    }
  });

  it('aggregates recovery, scanner, paper, and calibration counters', () => {
    const metrics = new MarketObservabilityService();
    metrics.increment('resyncAttempts', 2);
    metrics.increment('resyncSuccess');
    metrics.increment('paperOrders');
    metrics.set('brierScore', 0.12);
    expect(metrics.snapshot()).toMatchObject({
      resyncAttempts: 2,
      resyncSuccess: 1,
      paperOrders: 1,
      brierScore: 0.12,
    });
  });

  it('deduplicates automatic orderbook recovery jobs', async () => {
    jest.useFakeTimers();
    const events = new EventEmitter2();
    const marketData = { recoverOrderBook: jest.fn().mockResolvedValue(undefined), backfillCandles: jest.fn() };
    const scheduler = new RecoverySchedulerService(events, marketData as never, new MarketObservabilityService());
    const state = {
      symbol: 'BTCUSDT',
      marketType: 'spot',
      orderBook: { sequenceHealthy: false },
      dataQuality: { reasons: [] },
      timeframes: {},
    };

    events.emit('market.canonical.updated', { state });
    events.emit('market.canonical.updated', { state });
    jest.advanceTimersByTime(1_000);
    await Promise.resolve();

    expect(marketData.recoverOrderBook).toHaveBeenCalledTimes(1);
    scheduler.onModuleDestroy();
    jest.useRealTimers();
  });

  it('recovers an invalidated order book without retaining stale levels', () => {
    const book = new LocalOrderBookEngine();
    book.initialize({ lastUpdateId: 10, bids: [[100, 2], [99, 1]], asks: [[101, 2]] });
    expect(book.applyUpdate({ firstUpdateId: 12, finalUpdateId: 12, previousUpdateId: 10, eventTime: 1, bids: [], asks: [] })).toBe(false);
    expect(book.state().sequenceHealthy).toBe(false);
    book.initialize({ lastUpdateId: 20, bids: [[102, 3]], asks: [[103, 4]] });
    expect(book.state()).toMatchObject({ sequenceHealthy: true, bestBid: 102, bestAsk: 103, lastUpdateId: 20 });
    expect(book.state().bidDepth10).toBe(3);
  });

  it('ignores duplicate depth updates without invalidating sequence state', () => {
    const book = new LocalOrderBookEngine();
    book.initialize({ lastUpdateId: 100, bids: [[100, 2]], asks: [[101, 2]] });
    expect(book.applyUpdate({ firstUpdateId: 101, finalUpdateId: 101, previousUpdateId: 100, eventTime: 1, bids: [[100, 3]], asks: [] })).toBe(true);
    expect(book.applyUpdate({ firstUpdateId: 101, finalUpdateId: 101, previousUpdateId: 100, eventTime: 2, bids: [[100, 9]], asks: [] })).toBe(true);
    expect(book.state()).toMatchObject({ sequenceHealthy: true, lastUpdateId: 101, bestBid: 100 });
    expect(book.state().bidDepth10).toBe(3);
  });

  it('reconciles sequence across a connection handover', () => {
    const book = new LocalOrderBookEngine();
    book.initialize({ lastUpdateId: 100, bids: [[100, 1]], asks: [[101, 1]] });
    expect(book.applyUpdate({ firstUpdateId: 101, finalUpdateId: 102, previousUpdateId: 100, eventTime: 1, bids: [[100, 2]], asks: [] })).toBe(true);
    const handoverSnapshot = book.state();
    book.initialize({ lastUpdateId: handoverSnapshot.lastUpdateId!, bids: [[100, 2]], asks: [[101, 1]] });
    expect(book.applyUpdate({ firstUpdateId: 103, finalUpdateId: 103, previousUpdateId: 102, eventTime: 2, bids: [[99, 3]], asks: [] })).toBe(true);
    expect(book.applyUpdate({ firstUpdateId: 101, finalUpdateId: 102, previousUpdateId: 100, eventTime: 3, bids: [[100, 9]], asks: [] })).toBe(true);
    expect(book.state()).toMatchObject({ sequenceHealthy: true, lastUpdateId: 103, bestBid: 100, bestAsk: 101 });
    expect(book.state().bidDepth10).toBe(5);
  });

  it('hands over streams and keeps subscriptions bounded and unique', async () => {
    class MockSocket {
      readyState = 1;
      sent: string[] = [];
      handlers = new Map<string, (value?: any) => void>();
      on(event: string, handler: (value?: any) => void) { this.handlers.set(event, handler); }
      send(value: string) { this.sent.push(value); }
      close() { this.readyState = 3; this.handlers.get('close')?.(); }
      terminate() { this.close(); }
      pong() {}
      open() { this.handlers.get('open')?.(); }
      message(value: string) { this.handlers.get('message')?.(Buffer.from(value)); }
    }
    const sockets: MockSocket[] = [];
    const manager = new BinanceStreamManager('spot', (() => {
      const socket = new MockSocket();
      sockets.push(socket);
      return socket as never;
    }) as never);
    manager.subscribe('btcusdt@aggTrade');
    manager.subscribe('BTCUSDT@aggTrade');
    manager.connect();
    sockets[0].open();
    sockets[0].message('not-json');
    expect(manager.status().health).toBe('DEGRADED');
    const handover = manager.handover(1000);
    sockets[1].open();
    expect(await handover).toBe(true);
    expect(manager.status().subscriptions).toEqual(['btcusdt@aggtrade']);
    sockets[0].message(JSON.stringify({ e: 'aggTrade', E: 10, s: 'BTCUSDT' }));
    sockets[1].message(JSON.stringify({ e: 'aggTrade', E: 11, s: 'BTCUSDT' }));
    manager.close();
  });

  it('survives a bounded high-rate stream and rotates on a short test lifetime', () => {
    class SoakSocket {
      readyState = 1;
      handlers = new Map<string, (value?: any) => void>();
      on(event: string, handler: (value?: any) => void) { this.handlers.set(event, handler); }
      send() {}
      close() { this.readyState = 3; this.handlers.get('close')?.(); }
      terminate() { this.close(); }
      pong() {}
      open() { this.handlers.get('open')?.(); }
      message(value: string) { this.handlers.get('message')?.(Buffer.from(value)); }
    }
    jest.useFakeTimers();
    const sockets: SoakSocket[] = [];
    const manager = new BinanceStreamManager('futures', (() => {
      const socket = new SoakSocket();
      sockets.push(socket);
      return socket as never;
    }) as never, 1_000);
    let events = 0;
    manager.onEvent(() => { events += 1; });
    manager.subscribe('btcusdt@aggTrade');
    manager.connect();
    sockets[0].open();
    for (let index = 0; index < 10_000; index += 1) {
      sockets[0].message(JSON.stringify({ e: 'aggTrade', E: index, s: 'BTCUSDT' }));
    }
    expect(events).toBe(10_000);
    expect(manager.status().subscriptions).toHaveLength(1);
    jest.advanceTimersByTime(1_000);
    expect(manager.status().health).toBe('DEGRADED');
    manager.close();
    jest.useRealTimers();
  });

  it('ignores delayed events from the old connection across repeated rotations', () => {
    class RotationSocket {
      readyState = 1;
      handlers = new Map<string, (value?: any) => void>();
      on(event: string, handler: (value?: any) => void) { this.handlers.set(event, handler); }
      send() {}
      close() { this.readyState = 3; this.handlers.get('close')?.(); }
      terminate() { this.close(); }
      pong() {}
      open() { this.handlers.get('open')?.(); }
      message(value: string) { this.handlers.get('message')?.(Buffer.from(value)); }
    }
    jest.useFakeTimers();
    const sockets: RotationSocket[] = [];
    const manager = new BinanceStreamManager('spot', (() => {
      const socket = new RotationSocket();
      sockets.push(socket);
      return socket as never;
    }) as never, 100);
    const events: number[] = [];
    manager.onEvent((event) => events.push(Number(event.E)));
    manager.connect();
    sockets[0].open();
    sockets[0].message(JSON.stringify({ e: 'aggTrade', E: 1 }));
    for (let cycle = 0; cycle < 3; cycle += 1) {
      jest.advanceTimersByTime(100);
      jest.advanceTimersByTime(500);
      sockets.at(-1)!.open();
      sockets[0].message(JSON.stringify({ e: 'aggTrade', E: -cycle - 1 }));
      sockets.at(-1)!.message(JSON.stringify({ e: 'aggTrade', E: cycle + 2 }));
    }
    expect(events.filter((event) => event < 0)).toHaveLength(0);
    expect(events).toEqual([1, 2, 3, 4]);
    manager.close();
    jest.useRealTimers();
  });

  it('exports aggregate observability values to Prometheus', () => {
    const metrics = new MarketObservabilityService();
    metrics.increment('scans', 2);
    metrics.set('brierScore', 0.25);
    const scanMetric = promClient.register.getSingleMetric('market_intelligence_scans') as promClient.Gauge<string>;
    expect(scanMetric).toBeDefined();
    expect(metrics.snapshot()).toMatchObject({ scans: 2, brierScore: 0.25 });
  });

  it('prevents scanner overlap and blocks scanning when the registry is empty', async () => {
    const registry = {
      awaitReady: jest.fn().mockResolvedValue({ status: 'INVALID' }),
      list: jest.fn().mockResolvedValue([]),
    };
    const scanner = { scan: jest.fn().mockReturnValue({ candidates: [], metrics: { candidateCount: 0, noTradeCount: 0 } }) };
    const metrics = new MarketObservabilityService();
    const scheduler = new MarketIntelligenceScheduler(
      { sync: jest.fn() } as never,
      registry as never,
      scanner as unknown as UniverseScannerService,
      metrics,
      { awaitReady: jest.fn().mockResolvedValue({ status: 'NOT_READY', canonicalPopulated: 0, canonicalFresh: 0, canonicalStale: 0, failed: 0 }) } as never,
    );
    await scheduler.scanCanonicalUniverse();
    await scheduler.scanCanonicalUniverse();
    expect(scanner.scan).not.toHaveBeenCalled();
    expect(metrics.snapshot().scans).toBe(0);
  });
});
