import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BaseCollector } from './base.collector';
import { MarketSnapshot } from '../interfaces/market-data.interface';

@Injectable()
export class LiquidationCollector extends BaseCollector {
  constructor(eventEmitter: EventEmitter2) {
    super(eventEmitter);
    this.source = 'liquidations';
  }

  async collect(symbol: string, timeframe: string): Promise<MarketSnapshot> {
    const snapshot: MarketSnapshot = {
      symbol,
      timeframe,
      source: this.source,
      payload: { provider: 'liquidations', symbol, timeframe },
      normalized: { liquidationVolume: 0, timestamp: Date.now() },
      createdAt: new Date(),
      fetchedAt: new Date(),
    };
    this.emitSnapshot(snapshot);
    return snapshot;
  }
}
