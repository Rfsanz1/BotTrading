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
      const data = await res.json();
      const price = data[normalized]?.usd;
      if (!price) throw new Error('Price not found');
      return Number(price);
    } catch (error) {
      this.logger.warn(`Market fetch failed for ${symbol}: ${error.message}`);
      // Return a mock price as fallback
      return 0;
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
