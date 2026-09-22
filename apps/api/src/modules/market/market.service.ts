import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);

  async fetchCurrentPrice(symbol: string): Promise<number> {
    try {
      const normalized = symbol.replace('/', '').toUpperCase();
      if (!/^[A-Z0-9]{5,20}$/.test(normalized)) throw new Error('Invalid Binance symbol');
      const url = `https://api.binance.com/api/v3/ticker/price?symbol=${encodeURIComponent(normalized)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Binance returned ${res.status}`);
      const data: unknown = await res.json();
      const price = typeof data === 'object' && data !== null
        ? (data as Record<string, unknown>).price
        : undefined;
      if ((typeof price !== 'number' && typeof price !== 'string') || !Number.isFinite(Number(price))) {
        throw new Error('Price not found');
      }
      return Number(price);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Binance market fetch failed for ${symbol}: ${message}`);
      throw new Error(`Authoritative market price unavailable for ${symbol}`);
    }
  }

  async fetchMarketData(symbol: string): Promise<Record<string, any>> {
    // Minimal market data for analysis
    const currentPrice = await this.fetchCurrentPrice(symbol);
    return {
      symbol,
      currentPrice,
      fetchedAt: new Date(),
    };
  }
}
