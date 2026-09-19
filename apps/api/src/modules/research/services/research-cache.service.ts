import { Injectable } from '@nestjs/common';
import { RedisService } from '../../../common/redis.service';
import { ResearchResult } from '../interfaces/research.interface';

@Injectable()
export class ResearchCacheService {
  constructor(private readonly redis: RedisService) {}

  async get(symbol: string, timeframe: string, exchange: string): Promise<ResearchResult | null> {
    const raw = await this.redis.getJson(`research:${symbol}:${timeframe}:${exchange}`);
    return raw as ResearchResult | null;
  }

  async set(symbol: string, timeframe: string, exchange: string, result: ResearchResult): Promise<void> {
    await this.redis.setJson(`research:${symbol}:${timeframe}:${exchange}`, result);
  }
}
