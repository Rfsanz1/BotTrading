export interface MarketSnapshot {
  id?: string;
  symbol: string;
  timeframe: string;
  source: string;
  payload: Record<string, unknown>;
  normalized: Record<string, unknown>;
  createdAt: Date;
  fetchedAt: Date;
}

export interface CollectorConfig {
  enabled: boolean;
  intervalMs: number;
  retries: number;
  timeoutMs: number;
  symbols: string[];
  timeframes: string[];
}

export interface MarketCollector {
  readonly name: string;
  readonly source: string;
  collect(symbol: string, timeframe: string): Promise<MarketSnapshot>;
  start(): Promise<void>;
  stop(): Promise<void>;
}
