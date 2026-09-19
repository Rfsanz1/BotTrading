export interface SymbolRegistryEntry {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  exchange: string;
  enabled: boolean;
  createdAt: Date;
}

export interface SymbolRegistry {
  register(entry: SymbolRegistryEntry): Promise<void>;
  list(): Promise<SymbolRegistryEntry[]>;
  get(symbol: string): Promise<SymbolRegistryEntry | null>;
}
