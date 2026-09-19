import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MarketCollectedEvent } from '../events/market-collected.event';
import { MarketAggregationEvent } from '../events/market-aggregation.event';
import { MarketSnapshot } from '../interfaces/market-data.interface';

@Injectable()
export class MarketAggregatorService {
  private readonly logger = new Logger(MarketAggregatorService.name);
  private readonly snapshots = new Map<string, MarketSnapshot>();

  constructor(private readonly eventEmitter: EventEmitter2) {
    this.eventEmitter.on('market.collected', (snapshot: MarketSnapshot) => this.handleSnapshot(snapshot));
  }

  private handleSnapshot(snapshot: MarketSnapshot): void {
    const key = `${snapshot.symbol}:${snapshot.timeframe}:${snapshot.source}`;
    this.snapshots.set(key, snapshot);
    const aggregated = this.aggregate(snapshot);
    this.eventEmitter.emit('market.aggregated', new MarketAggregationEvent(snapshot.symbol, snapshot.timeframe, aggregated));
  }

  private aggregate(snapshot: MarketSnapshot): Record<string, unknown> {
    return {
      symbol: snapshot.symbol,
      timeframe: snapshot.timeframe,
      source: snapshot.source,
      normalized: snapshot.normalized,
      aggregatedAt: new Date().toISOString(),
    };
  }

  getSnapshot(symbol: string, timeframe: string): MarketSnapshot | undefined {
    return Array.from(this.snapshots.values()).find((snapshot) => snapshot.symbol === symbol && snapshot.timeframe === timeframe);
  }

  listSnapshots(): MarketSnapshot[] {
    return Array.from(this.snapshots.values());
  }
}
