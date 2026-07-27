import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MarketCollector } from '../interfaces/market-data.interface';
import { MarketRepository } from '../repositories/market-repository';
import { RedisService } from '../../../common/redis.service';

@Injectable()
export class MarketSyncService {
  private readonly logger = new Logger(MarketSyncService.name);

  constructor(
    private readonly collectors: MarketCollector[],
    private readonly repository: MarketRepository,
    private readonly redis: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async sync(symbols: string[], timeframes: string[]): Promise<void> {
    for (const collector of this.collectors) {
      for (const symbol of symbols) {
        for (const timeframe of timeframes) {
          try {
            const snapshot = await collector.collect(symbol, timeframe);
            await this.redis.setJson(`market:${symbol}:${timeframe}:${collector.source}`, snapshot);
            await this.repository.createSnapshot({
              id: `${collector.source}-${Date.now()}`,
              symbol,
              timeframe,
              source: collector.source,
              payload: snapshot.payload,
              normalized: snapshot.normalized,
            });
            this.eventEmitter.emit('market.collected', snapshot);
          } catch (error) {
            this.logger.warn(`Sync failed for ${collector.source}/${symbol}/${timeframe}: ${error.message}`);
          }
        }
      }
    }
  }
}
