import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression, Interval } from '@nestjs/schedule';
import { MarketSyncService } from './services/market-sync.service';
import { SymbolRegistryService } from './services/symbol-registry.service';
import { UniverseScannerService } from './services/universe-scanner.service';
import { MarketObservabilityService } from './services/market-observability.service';
import { BinanceMarketDataService } from './services/binance-market-data.service';

@Injectable()
export class MarketIntelligenceScheduler {
  private readonly logger = new Logger(MarketIntelligenceScheduler.name);
  private scannerRunning = false;
  private scanId = 0;

  constructor(
    private readonly syncService: MarketSyncService,
    private readonly symbols: SymbolRegistryService,
    private readonly scanner: UniverseScannerService,
    private readonly metrics: MarketObservabilityService,
    private readonly marketData: BinanceMarketDataService,
  ) {}

  @Interval(Number(process.env.BINANCE_SYMBOL_REFRESH_MS ?? 300_000))
  async refreshSymbolRegistry(): Promise<void> {
    await this.symbols.syncSpotSymbolsFromBinance();
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async syncMarketData(): Promise<void> {
    this.logger.log('Executing scheduled market intelligence sync');

    try {
      const registry = await this.symbols.awaitReady();
      if (registry.status === 'INVALID') {
        this.logger.warn(`Scheduled market intelligence sync skipped: symbol registry status=${registry.status}`);
        return;
      }
      const entries = (await this.symbols.list()).filter((entry) => entry.enabled && entry.marketType === 'spot');
      const limit = Math.max(1, Number(process.env.MARKET_SYNC_SYMBOL_LIMIT ?? 20));
      await this.syncService.sync(entries.slice(0, limit).map((entry) => entry.symbol), ['1m', '5m', '1H']);
    } catch (error) {
      this.logger.error('Scheduled market intelligence sync failed', error instanceof Error ? error.stack : error);
    }
  }

  @Cron(CronExpression.EVERY_30_SECONDS)
  async scanCanonicalUniverse(): Promise<void> {
    if (this.scannerRunning) return;
    this.scannerRunning = true;
    const currentScanId = ++this.scanId;
    const started = Date.now();
    try {
      const registry = await this.symbols.awaitReady();
      const bootstrap = await this.marketData.awaitReady();
      const allEntries = await this.symbols.list();
      const registryTotal = allEntries.length;
      const registryEnabled = allEntries.filter((entry) => entry.enabled).length;
      const registrySpotUsdt = allEntries.filter((entry) => entry.enabled && entry.exchange === 'binance' && entry.marketType === 'spot' && entry.quoteAsset === 'USDT').length;
      this.metrics.set('registryTotal', registryTotal);
      this.metrics.set('registryEnabled', registryEnabled);
      this.metrics.set('registrySpotUsdt', registrySpotUsdt);
      const entries = allEntries.filter((entry) => entry.enabled && entry.exchange === 'binance' && entry.marketType === 'spot' && entry.quoteAsset === 'USDT');
      const symbols = entries.map((entry) => entry.symbol);
      const symbolsRejected = Math.max(0, registryTotal - entries.length);
      this.metrics.set('symbolsSeen', registryTotal);
      this.metrics.set('symbolsEligible', entries.length);
      this.metrics.set('symbolsRejected', symbolsRejected);
      this.logger.log(`Scanner registry: status=${registry.status} registryTotal=${registryTotal} registryEnabled=${registryEnabled} registrySpotUsdt=${registrySpotUsdt} symbolsSeen=${registryTotal} symbolsEligible=${entries.length} symbolsRejected=${symbolsRejected}`);
      if (registry.status === 'INVALID' || entries.length === 0 || !['READY', 'DEGRADED'].includes(bootstrap.status)) {
        this.logger.warn(`Canonical scanner ${currentScanId} NOT_READY: bootstrapStatus=${bootstrap.status} canonicalPopulated=${bootstrap.canonicalPopulated} canonicalFresh=${bootstrap.canonicalFresh} canonicalStale=${bootstrap.canonicalStale} failed=${bootstrap.failed}`);
        this.metrics.set('scannerDataEligible', 0);
        this.metrics.set('scannerDataRejected', entries.length);
        return;
      }
      const stream = typeof (this.marketData as unknown as { status?: () => { spot: { shardCount: number; coveragePercent: number; streamsActive: number; streamsRequested: number; healthyShards: number; eventsReceived: number } } }).status === 'function'
        ? this.marketData.status().spot
        : null;
      if (process.env.ENABLE_BINANCE_MARKET_STREAMS === 'true' && stream && stream.shardCount > 0 && stream.coveragePercent < 100) {
        this.logger.warn(`Canonical scanner ${currentScanId} DATA_DEGRADED: websocketCoverage=${stream.coveragePercent}% active=${stream.streamsActive}/${stream.streamsRequested} healthyShards=${stream.healthyShards}/${stream.shardCount} eventsReceived=${stream.eventsReceived}`);
        this.metrics.set('scannerDataEligible', 0);
        this.metrics.set('scannerDataRejected', entries.length);
        return;
      }
      const result = this.scanner.scan(symbols, 'spot');
      this.metrics.set('scannerDataEligible', result.metrics.symbolsEligible);
      this.metrics.set('scannerDataRejected', result.metrics.symbolsRejected);
      this.metrics.increment('scans');
      this.metrics.increment('candidates', result.metrics.candidateCount);
      this.metrics.increment('noTrades', result.metrics.noTradeCount);
      this.metrics.set('scannerDurationMs', Date.now() - started);
      this.logger.log(`Canonical scanner ${currentScanId} completed: symbolsSeen=${result.metrics.symbolsSeen ?? symbols.length} symbolsEligible=${result.metrics.symbolsEligible ?? symbols.length} symbolsRejected=${result.metrics.symbolsRejected ?? 0} candidates=${result.candidates.length}`);
    } catch (error) {
      this.logger.error(`Canonical scanner ${currentScanId} failed`, error instanceof Error ? error.stack : String(error));
    } finally {
      this.scannerRunning = false;
    }
  }
}
