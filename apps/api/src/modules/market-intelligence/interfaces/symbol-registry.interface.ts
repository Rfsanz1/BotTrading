export interface SymbolRegistryEntry {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  exchange: string;
  marketType: 'spot' | 'futures';
  status: string;
  enabled: boolean;
  spotTradable: boolean;
  futuresTradable: boolean;
  source: string;
  lastSyncedAt: Date;
  filters?: unknown[];
  createdAt: Date;
}

export interface SymbolRegistry {
  register(entry: SymbolRegistryEntry): Promise<void>;
  list(): Promise<SymbolRegistryEntry[]>;
  get(symbol: string): Promise<SymbolRegistryEntry | null>;
  syncSpotSymbolsFromBinance(): Promise<SymbolRegistryHealth>;
  awaitReady(): Promise<SymbolRegistryHealth>;
  health(): SymbolRegistryHealth;
}

export type SymbolRegistryHealthStatus = 'HEALTHY' | 'DEGRADED' | 'INVALID';

export interface SymbolRegistryHealth {
  status: SymbolRegistryHealthStatus;
  symbolCount: number;
  enabledCount: number;
  spotUsdtCount: number;
  spotCount: number;
  futuresCount: number;
  lastSuccessfulSync: number | null;
  lastAttempt: number | null;
  syncDurationMs: number | null;
  error: string | null;
}
