import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ResearchService } from '../services/research.service';
import { ResearchRepository } from '../repositories/research.repository';
import { ResearchCacheService } from '../services/research-cache.service';
import { EventEmitter2 } from '@nestjs/event-emitter';

class MockRepository extends ResearchRepository {
  async saveJob(): Promise<void> {}
  async updateJobStatus(): Promise<void> {}
  async saveResult(): Promise<void> {}
  async listHistory(): Promise<any[]> { return []; }
  async getLatest(): Promise<any> { return null; }
}

class MockCache extends ResearchCacheService {
  private data = new Map<string, any>();
  async get(symbol: string, timeframe: string, exchange: string): Promise<any> {
    return this.data.get(`${symbol}:${timeframe}:${exchange}`) || null;
  }
  async set(symbol: string, timeframe: string, exchange: string, result: any): Promise<void> {
    this.data.set(`${symbol}:${timeframe}:${exchange}`, result);
  }
}

describe('ResearchService', () => {
  it('produces a scored research result for a symbol', async () => {
    const service = new ResearchService(new MockRepository({} as any) as any, new MockCache({} as any) as any, new EventEmitter2());
    const result = await service.runResearch('BTC/USDT', '1H', 'binance');
    assert.ok(result.researchScore > 0);
    assert.ok(result.researchConfidence > 0);
    assert.ok(result.sources.length > 0);
  });
});
