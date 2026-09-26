import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  SymbolRegistry,
  SymbolRegistryEntry,
  SymbolRegistryHealth,
} from '../interfaces/symbol-registry.interface';
import {
  BinanceMarketClient,
  BinanceExchangeInfoSymbol,
  hasSpotPermission,
  normalizeSymbol,
} from '../collectors/binance-market-client';

@Injectable()
export class SymbolRegistryService implements SymbolRegistry, OnModuleInit {
  private readonly logger = new Logger(SymbolRegistryService.name);
  private registry = new Map<string, SymbolRegistryEntry>();
  private syncing = false;
  private lastSuccessfulSync: number | null = null;
  private lastAttempt: number | null = null;
  private syncDurationMs: number | null = null;
  private error: string | null = null;
  private initialSync: Promise<SymbolRegistryHealth> | null = null;

  constructor(private readonly client: BinanceMarketClient = new BinanceMarketClient()) {}

  async onModuleInit(): Promise<void> {
    this.initialSync = this.syncSpotSymbolsFromBinance();
    await this.initialSync;
  }

  async register(entry: SymbolRegistryEntry): Promise<void> {
    const symbol = normalizeSymbol(entry.symbol);
    const now = new Date();
    this.registry.set(symbol, {
      ...entry,
      symbol,
      createdAt: entry.createdAt || now,
      lastSyncedAt: entry.lastSyncedAt || now,
    });
  }

  async list(): Promise<SymbolRegistryEntry[]> {
    return Array.from(this.registry.values());
  }

  async get(symbol: string): Promise<SymbolRegistryEntry | null> {
    return this.registry.get(normalizeSymbol(symbol)) || null;
  }

  health(): SymbolRegistryHealth {
    const entries = [...this.registry.values()];
    return {
      status: this.lastSuccessfulSync === null ? 'INVALID' : this.error ? 'DEGRADED' : 'HEALTHY',
      symbolCount: entries.length,
      enabledCount: entries.filter((entry) => entry.enabled).length,
      spotUsdtCount: entries.filter((entry) => entry.marketType === 'spot' && entry.quoteAsset === 'USDT').length,
      spotCount: entries.filter((entry) => entry.marketType === 'spot').length,
      futuresCount: entries.filter((entry) => entry.marketType === 'futures').length,
      lastSuccessfulSync: this.lastSuccessfulSync,
      lastAttempt: this.lastAttempt,
      syncDurationMs: this.syncDurationMs,
      error: this.error,
    };
  }

  async awaitReady(): Promise<SymbolRegistryHealth> {
    if (!this.initialSync) {
      this.initialSync = this.syncSpotSymbolsFromBinance();
    }
    await this.initialSync;
    return this.health();
  }

  async syncSpotSymbolsFromBinance(): Promise<SymbolRegistryHealth> {
    if (this.syncing) return this.health();
    this.syncing = true;
    const started = Date.now();
    this.lastAttempt = started;
    try {
      const info = await this.client.spotExchangeInfo();
      const desired = new Map<string, SymbolRegistryEntry>();
      for (const item of info.symbols ?? []) {
        const entry = this.toSpotEntry(item);
        if (entry) desired.set(entry.symbol, entry);
      }
      const existingSpotCount = [...this.registry.values()].filter((entry) => entry.marketType === 'spot').length;
      if (desired.size === 0) {
        this.error = 'Binance exchangeInfo returned no eligible Spot USDT symbols';
        this.syncDurationMs = Date.now() - started;
        const health = this.health();
        if (existingSpotCount === 0) {
          this.logger.warn(`Symbol registry sync unavailable: source=binance market=spot status=${health.status} error=${this.error}`);
        } else {
          this.logger.warn(`Symbol registry refresh degraded: preserving ${existingSpotCount} existing Spot symbols error=${this.error}`);
        }
        return health;
      }
      this.registry = new Map([...this.registry].filter(([, entry]) => entry.marketType !== 'spot'));
      for (const [symbol, entry] of desired) this.registry.set(symbol, entry);
      this.lastSuccessfulSync = Date.now();
      this.syncDurationMs = Date.now() - started;
      this.error = null;
      const health = this.health();
      this.logger.log(`Symbol registry sync successful: source=binance market=spot total=${health.symbolCount} enabled=${health.enabledCount} spotUsdt=${health.spotUsdtCount} durationMs=${health.syncDurationMs}`);
      return health;
    } catch (error) {
      this.syncDurationMs = Date.now() - started;
      this.error = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Symbol registry sync failed: source=binance market=spot status=${this.health().status} error=${this.error}`);
      return this.health();
    } finally {
      this.syncing = false;
    }
  }

  private toSpotEntry(item: BinanceExchangeInfoSymbol): SymbolRegistryEntry | null {
    if (
      item.status !== 'TRADING' ||
      item.quoteAsset !== 'USDT' ||
      item.isSpotTradingAllowed !== true ||
      !hasSpotPermission(item) ||
      !Array.isArray(item.filters)
    ) return null;
    let symbol: string;
    try {
      symbol = normalizeSymbol(item.symbol);
      if (!item.baseAsset || !item.quoteAsset || symbol !== normalizeSymbol(`${item.baseAsset}${item.quoteAsset}`)) {
        return null;
      }
    } catch {
      return null;
    }
    const now = new Date();
    return {
      symbol,
      baseAsset: item.baseAsset,
      quoteAsset: item.quoteAsset,
      exchange: 'binance',
      marketType: 'spot',
      status: item.status,
      enabled: true,
      spotTradable: true,
      futuresTradable: false,
      source: 'binance-exchangeInfo',
      lastSyncedAt: now,
      filters: item.filters,
      createdAt: now,
    };
  }
}
