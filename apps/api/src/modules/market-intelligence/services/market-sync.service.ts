import { Inject, Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MarketCollector } from '../interfaces/market-data.interface';
import { MarketRepository } from '../repositories/market-repository';
import { RedisService } from '../../../common/redis.service';

@Injectable()
export class MarketSyncService {
  private readonly logger = new Logger(MarketSyncService.name);

  constructor(
    @Inject('MARKET_COLLECTORS') private readonly collectors: MarketCollector[],
    private readonly repository: MarketRepository,
    private readonly redis: RedisService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async sync(symbols: string[], timeframes: string[]): Promise<void> {
    const jobs = this.collectors.flatMap((collector) =>
      symbols.flatMap((symbol) => timeframes.map((timeframe) => ({ collector, symbol, timeframe }))),
    );
    const concurrency = Math.max(1, Math.min(8, Number(process.env.MARKET_SYNC_CONCURRENCY ?? 4)));
    let next = 0;
    const worker = async (): Promise<void> => {
      while (next < jobs.length) {
        const job = jobs[next++];
        try {
          const snapshot = await job.collector.collect(job.symbol, job.timeframe);
          await this.redis.setJson(`market:${job.symbol}:${job.timeframe}:${job.collector.source}`, snapshot);
          await this.repository.createSnapshot({
            id: `${job.collector.source}-${job.symbol}-${job.timeframe}-${snapshot.fetchedAt.getTime()}`,
            symbol: job.symbol,
            timeframe: job.timeframe,
            source: job.collector.source,
            payload: snapshot.payload,
            normalized: snapshot.normalized,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          this.logger.warn(`Sync failed for ${job.collector.source}/${job.symbol}/${job.timeframe}: ${message}`);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, () => worker()));
  }
}
