import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BaseCollector } from './base.collector';
import { MarketSnapshot } from '../interfaces/market-data.interface';
import { BinanceMarketClient } from './binance-market-client';

@Injectable()
export class OpenInterestCollector extends BaseCollector {
  constructor(eventEmitter: EventEmitter2, private readonly client: BinanceMarketClient = new BinanceMarketClient()) {
    super(eventEmitter);
    this.source = 'open-interest';
  }

  async collect(symbol: string, timeframe: string): Promise<MarketSnapshot> {
    const openInterest = await this.withRetry(() => this.client.openInterest(symbol));
    const snapshot: MarketSnapshot = {
      symbol,
      timeframe,
      source: this.source,
      payload: { provider: 'binance-usdm', symbol, timeframe, openInterest },
      normalized: { openInterest: openInterest.openInterest, timestamp: openInterest.time },
      createdAt: new Date(),
      fetchedAt: new Date(),
    };
    this.emitSnapshot(snapshot);
    return snapshot;
  }
}
