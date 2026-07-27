import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BaseCollector } from './base.collector';
import { MarketSnapshot } from '../interfaces/market-data.interface';

@Injectable()
export class VolumeProfileCollector extends BaseCollector {
  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
    this.source = 'volume-profile';
  }

  async collect(symbol: string, timeframe: string): Promise<MarketSnapshot> {
    const snapshot: MarketSnapshot = {
      symbol,
      timeframe,
      source: this.source,
      payload: { provider: 'volume-profile', symbol, timeframe },
      normalized: { volumeProfile: [], timestamp: Date.now() },
      createdAt: new Date(),
      fetchedAt: new Date(),
    };
    this.emitSnapshot(snapshot);
    return snapshot;
  }
}
