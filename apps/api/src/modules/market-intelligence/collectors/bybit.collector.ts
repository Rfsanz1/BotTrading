import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BaseCollector } from './base.collector';
import { MarketSnapshot } from '../interfaces/market-data.interface';

@Injectable()
export class BybitCollector extends BaseCollector {
  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
    this.source = 'bybit';
  }

  async collect(symbol: string, timeframe: string): Promise<MarketSnapshot> {
    const snapshot: MarketSnapshot = {
      symbol,
      timeframe,
      source: this.source,
      payload: { provider: 'bybit', symbol, timeframe },
      normalized: { price: 0, volume: 0, timestamp: Date.now() },
      createdAt: new Date(),
      fetchedAt: new Date(),
    };
    this.emitSnapshot(snapshot);
    return snapshot;
  }
}
