import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { BinanceStreamManager } from './binance-stream.manager';
import { BinanceShardManagerService, StreamShardAggregate } from './binance-shard-manager.service';
import { MarketStreamEventRouterService } from './market-stream-event-router.service';
import { BinanceMarketClient } from '../collectors/binance-market-client';
import { CanonicalMarketCacheService } from './canonical-market-cache.service';
import { CanonicalCandle, CanonicalTimeframe } from '../interfaces/canonical-market.interface';
import { SymbolRegistryService } from './symbol-registry.service';
import { MarketObservabilityService } from './market-observability.service';

@Injectable()
export class BinanceMarketDataService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(BinanceMarketDataService.name);
  private readonly futures: BinanceStreamManager;
  private firstSpotWsUpdateAt: number | null = null;
  private latestSpotWsUpdateAt: number | null = null;
  private bootstrapPromise: Promise<SpotBootstrapHealth> | null = null;
  private bootstrapHealth: SpotBootstrapHealth = {
    status: 'NOT_READY', requested: 0, succeeded: 0, failed: 0,
    candlesHydrated: 0, orderbooksHydrated: 0, canonicalPopulated: 0,
    canonicalFresh: 0, canonicalStale: 0, failures: [],
  };

  constructor(
    private readonly router: MarketStreamEventRouterService,
    private readonly client: BinanceMarketClient,
    private readonly cache: CanonicalMarketCacheService,
    private readonly symbols: SymbolRegistryService,
    private readonly metrics: MarketObservabilityService,
    private readonly spotShards: BinanceShardManagerService,
  ) {
    this.futures = new BinanceStreamManager('futures');
    this.futures.onEvent((event) => this.router.route('futures', event));
  }

  async onModuleInit(): Promise<void> {
    this.bootstrapPromise = this.bootstrapSpot();
    await this.bootstrapPromise;
    if (process.env.ENABLE_BINANCE_MARKET_STREAMS === 'true') {
      const entries = (await this.symbols.list()).filter((entry) => entry.enabled && entry.exchange === 'binance' && entry.marketType === 'spot' && entry.quoteAsset === 'USDT');
      const streams = entries.flatMap(({ symbol }) => [
        `${symbol}@aggTrade`, `${symbol}@bookTicker`, `${symbol}@kline_1m`, `${symbol}@kline_5m`, `${symbol}@depth@100ms`,
      ]);
      const maxStreamsPerShard = Math.max(1, Number(process.env.BINANCE_WS_MAX_STREAMS_PER_SHARD ?? 80));
      const maxUrlBytes = Math.max(512, Number(process.env.BINANCE_WS_MAX_URL_BYTES ?? 6000));
      const maxShards = Math.max(1, Number(process.env.BINANCE_WS_MAX_SHARDS ?? 64));
      this.spotShards.createStreamShards('spot', streams, { maxStreamsPerShard, maxUrlBytes, maxShards }, (event) => {
        this.router.route('spot', event);
        const receivedAt = Date.now();
        this.firstSpotWsUpdateAt ??= receivedAt;
        this.latestSpotWsUpdateAt = receivedAt;
      });
      this.spotShards.start();
      const aggregate = this.spotShards.aggregate('spot');
      this.logger.log(`Binance Spot streams assigned: symbols=${entries.length} shards=${aggregate.shardCount} requested=${aggregate.streamsRequested} assigned=${aggregate.streamsAssigned} active=${aggregate.streamsActive}`);
      this.metrics.set('activeShards', aggregate.healthyShards);
      this.metrics.set('streamConnections', aggregate.shardCount);
      setTimeout(() => {
        this.logSpotStreamStatus();
      }, 15_000);
    }
  }

  onModuleDestroy(): void {
    this.spotShards.stop();
    this.futures.close();
  }

  subscribeSpot(streams: string[]): void {
    this.spotShards.createStreamShards('spot', streams, {
      maxStreamsPerShard: Math.max(1, Number(process.env.BINANCE_WS_MAX_STREAMS_PER_SHARD ?? 80)),
      maxUrlBytes: Math.max(512, Number(process.env.BINANCE_WS_MAX_URL_BYTES ?? 6000)),
      maxShards: Math.max(1, Number(process.env.BINANCE_WS_MAX_SHARDS ?? 64)),
    }, (event) => this.router.route('spot', event));
    this.spotShards.start();
  }

  subscribeFutures(streams: string[]): void {
    for (const stream of streams) this.futures.subscribe(stream);
  }

  status(): { spot: StreamShardAggregate; futures: ReturnType<BinanceStreamManager['status']> } {
    return { spot: this.spotShards.aggregate('spot'), futures: this.futures.status() };
  }

  private logSpotStreamStatus(): void {
    const status = this.spotShards.aggregate('spot');
    this.metrics.set('activeShards', status.healthyShards);
    this.metrics.set('streamConnections', status.shardCount);
    this.metrics.set('reconnects', status.reconnects);
    const eventAgeMs = status.lastEventAt === null ? null : Math.max(0, Date.now() - status.lastEventAt);
    this.logger.log(`Binance Spot stream status: shards=${status.shardCount} healthy=${status.healthyShards} degraded=${status.degradedShards} failed=${status.failedShards} requested=${status.streamsRequested} assigned=${status.streamsAssigned} active=${status.streamsActive} failedStreams=${status.streamsFailed} coverage=${status.coveragePercent}% messagesReceived=${status.messagesReceived} eventsReceived=${status.eventsReceived} reconnects=${status.reconnects} firstWsUpdateAt=${this.firstSpotWsUpdateAt ?? 'none'} latestWsUpdateAt=${this.latestSpotWsUpdateAt ?? 'none'} exchangeEventAt=${status.lastEventAt ?? 'none'} eventAgeMs=${eventAgeMs ?? 'none'}${status.eventsReceived === 0 ? ' error=NO_EVENTS_RECEIVED' : ''}`);
  }

  async awaitReady(): Promise<SpotBootstrapHealth> {
    if (this.bootstrapPromise) await this.bootstrapPromise;
    return { ...this.bootstrapHealth, failures: [...this.bootstrapHealth.failures] };
  }

  private async bootstrapSpot(): Promise<SpotBootstrapHealth> {
    const registry = await this.symbols.awaitReady();
    const entries = (await this.symbols.list()).filter((entry) => entry.enabled && entry.exchange === 'binance' && entry.marketType === 'spot' && entry.quoteAsset === 'USDT');
    this.bootstrapHealth = {
      ...this.bootstrapHealth,
      status: registry.status === 'HEALTHY' && entries.length > 0 ? 'BOOTSTRAPPING' : 'NOT_READY',
      requested: entries.length,
      failures: [],
    };
    this.metrics.set('hydrationRequested', entries.length);
    const concurrency = Math.max(1, Math.min(8, Number(process.env.MARKET_BOOTSTRAP_CONCURRENCY ?? 4)));
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < entries.length) {
        const entry = entries[next++];
        try {
          await this.hydrateSpotSymbol(entry.symbol);
          this.bootstrapHealth.succeeded += 1;
          this.metrics.increment('hydrationSucceeded');
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.bootstrapHealth.failed += 1;
          this.bootstrapHealth.failures.push(`${entry.symbol}: ${message}`);
          this.metrics.increment('hydrationFailed');
          this.logger.warn(`Spot canonical hydration failed: symbol=${entry.symbol} error=${message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, () => worker()));
    this.refreshBootstrapCounts(entries.map(({ symbol }) => symbol));
    this.bootstrapHealth.status = this.bootstrapHealth.succeeded > 0 && this.bootstrapHealth.canonicalFresh > 0
      ? (this.bootstrapHealth.failed === 0 ? 'READY' : 'DEGRADED') : 'NOT_READY';
    this.logger.log(`Spot canonical bootstrap: requested=${this.bootstrapHealth.requested} succeeded=${this.bootstrapHealth.succeeded} failed=${this.bootstrapHealth.failed} candles=${this.bootstrapHealth.candlesHydrated} orderbooks=${this.bootstrapHealth.orderbooksHydrated} canonicalPopulated=${this.bootstrapHealth.canonicalPopulated} canonicalFresh=${this.bootstrapHealth.canonicalFresh} canonicalStale=${this.bootstrapHealth.canonicalStale} status=${this.bootstrapHealth.status}`);
    return { ...this.bootstrapHealth, failures: [...this.bootstrapHealth.failures] };
  }

  private async hydrateSpotSymbol(symbol: string): Promise<void> {
    const timeframes: CanonicalTimeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
    const snapshot = await this.client.orderBook(symbol, 100);
    this.cache.initializeOrderBook(symbol, 'spot', snapshot);
    this.bootstrapHealth.orderbooksHydrated += 1;
    this.metrics.increment('orderbooksHydrated');
    for (const timeframe of timeframes) {
      await this.backfillCandles(symbol, 'spot', timeframe, 200);
      this.bootstrapHealth.candlesHydrated += 1;
      this.metrics.increment('candlesHydrated');
    }
  }

  private refreshBootstrapCounts(symbols: string[]): void {
    const states = symbols.map((symbol) => this.cache.get(symbol, 'spot')).filter(Boolean);
    this.bootstrapHealth.canonicalPopulated = states.length;
    this.bootstrapHealth.canonicalFresh = states.filter((state) => state!.dataQuality.state === 'HEALTHY' && state!.orderBook?.sequenceHealthy).length;
    this.bootstrapHealth.canonicalStale = states.length - this.bootstrapHealth.canonicalFresh;
    this.metrics.set('canonicalPopulated', this.bootstrapHealth.canonicalPopulated);
    this.metrics.set('canonicalFresh', this.bootstrapHealth.canonicalFresh);
    this.metrics.set('canonicalStale', this.bootstrapHealth.canonicalStale);
  }

  async hydrateFutures(symbol: string): Promise<void> {
    const [funding, fundingHistory, openInterest, openInterestHistory] = await Promise.all([
      this.client.funding(symbol),
      this.client.fundingHistory(symbol),
      this.client.openInterest(symbol),
      this.client.openInterestHistory(symbol),
    ]);
    this.cache.hydrateFutures(symbol, {
      currentFundingRate: funding.fundingRate,
      fundingHistory: fundingHistory.map((item) => item.fundingRate),
      currentOpenInterest: openInterest.openInterest,
      openInterestHistory: openInterestHistory.map((item) => item.openInterest),
    });
  }

  async recoverOrderBook(symbol: string, marketType: 'spot' | 'futures', retries = 3): Promise<void> {
    let lastError: unknown;
    for (let attempt = 0; attempt < Math.max(1, Math.min(retries, 3)); attempt += 1) {
      try {
        const snapshot = await this.client.orderBook(symbol, 100);
        this.cache.initializeOrderBook(symbol, marketType, snapshot);
        return;
      } catch (error) {
        lastError = error;
      }
    }

    throw new Error(`ORDERBOOK_RESYNC_FAILED: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  }

  async backfillCandles(symbol: string, marketType: 'spot' | 'futures', timeframe: CanonicalTimeframe, limit = 200): Promise<void> {
    const rows = await this.client.klines(symbol, timeframe, Math.min(Math.max(limit, 1), 1000), marketType === 'futures');
    const candles: CanonicalCandle[] = rows.map((row) => ({
      openTime: row.openTime, closeTime: row.closeTime, open: row.open, high: row.high,
      low: row.low, close: row.close, volume: row.volume, closed: true,
    }));
    this.cache.backfillCandles(symbol, marketType, timeframe, candles);
  }
}

export type SpotBootstrapStatus = 'NOT_READY' | 'BOOTSTRAPPING' | 'READY' | 'DEGRADED';
export interface SpotBootstrapHealth {
  status: SpotBootstrapStatus;
  requested: number;
  succeeded: number;
  failed: number;
  candlesHydrated: number;
  orderbooksHydrated: number;
  canonicalPopulated: number;
  canonicalFresh: number;
  canonicalStale: number;
  failures: string[];
}
