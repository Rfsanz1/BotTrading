import { Injectable } from '@nestjs/common';
import { CanonicalMarketType } from '../interfaces/canonical-market.interface';
import { CanonicalMarketCacheService } from './canonical-market-cache.service';

@Injectable()
export class MarketStreamEventRouterService {
  constructor(private readonly cache: CanonicalMarketCacheService) {}

  route(marketType: CanonicalMarketType, raw: Record<string, unknown>): void {
    const event = (raw.data ?? raw) as Record<string, unknown>;
    const symbol = typeof event.s === 'string' ? event.s : typeof event.symbol === 'string' ? event.symbol : null;
    if (!symbol) throw new Error('Market event has no symbol');
    this.cache.handle(symbol, marketType, event);
  }

  initializeOrderBook(
    marketType: CanonicalMarketType,
    symbol: string,
    snapshot: { lastUpdateId: number; bids: Array<[number, number]>; asks: Array<[number, number]> },
  ): void {
    this.cache.initializeOrderBook(symbol, marketType, snapshot);
  }
}
