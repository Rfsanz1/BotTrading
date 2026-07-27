import { Injectable } from '@nestjs/common';
import { SymbolRegistry, SymbolRegistryEntry } from '../interfaces/symbol-registry.interface';

@Injectable()
export class SymbolRegistryService implements SymbolRegistry {
  private readonly registry = new Map<string, SymbolRegistryEntry>();

  async register(entry: SymbolRegistryEntry): Promise<void> {
    this.registry.set(entry.symbol, { ...entry, createdAt: entry.createdAt || new Date() });
  }

  async list(): Promise<SymbolRegistryEntry[]> {
    return Array.from(this.registry.values());
  }

  async get(symbol: string): Promise<SymbolRegistryEntry | null> {
    return this.registry.get(symbol) || null;
  }
}
