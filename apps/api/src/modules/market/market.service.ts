import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class MarketService {
  private readonly logger = new Logger(MarketService.name);

  /**
   * Fetch current price using CoinGecko public API
   */
  async fetchCurrentPrice(symbol: string): Promise<number> {
    try {
      // symbol expected like BTC/USDT or BTC
      const normalized = symbol.split('/')[0].toLowerCase();
      const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(normalized)}&vs_currencies=usd`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`CoinGecko returned ${res.status}`);
      const data: unknown = await res.json();
      if (typeof data !== 'object' || data === null) {
        throw new Error('Invalid price response');
      }
      const quote = (data as Record<string, unknown>)[normalized];
      if (typeof quote !== 'object' || quote === null) {
        throw new Error('Price not found');
      }
      const price = (quote as Record<string, unknown>).usd;
      if ((typeof price !== 'number' && typeof price !== 'string') || !Number.isFinite(Number(price))) {
        throw new Error('Price not found');
      }
      return Number(price);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Market fetch failed for ${symbol}: ${message}`);
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
