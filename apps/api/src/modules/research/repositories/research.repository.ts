import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma.service';
import { ResearchJob, ResearchResult } from '../interfaces/research.interface';

@Injectable()
export class ResearchRepository {
  private readonly logger = new Logger(ResearchRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async saveJob(job: ResearchJob): Promise<void> {
    try {
      await this.prisma.$queryRawUnsafe(`
        INSERT INTO "MarketSnapshot" (id, "symbol", "timeframe", "source", "payload", "normalized", "createdAt", "fetchedAt")
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      `, `research-job-${job.id}`, job.symbol, job.timeframe, 'research', JSON.stringify(job), JSON.stringify(job));
    } catch (error) {
      this.logger.warn(`Unable to persist research job: ${error instanceof Error ? error.message : error}`);
    }
  }

  async updateJobStatus(id: string, status: ResearchJob['status'], result?: ResearchResult): Promise<void> {
    try {
      await this.prisma.$queryRawUnsafe(`
        INSERT INTO "MarketSnapshot" (id, "symbol", "timeframe", "source", "payload", "normalized", "createdAt", "fetchedAt")
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      `, `research-result-${id}`, result?.symbol || 'unknown', result?.timeframe || 'unknown', 'research-result', JSON.stringify({ status, result }), JSON.stringify({ status, result }));
    } catch (error) {
      this.logger.warn(`Unable to update research status: ${error instanceof Error ? error.message : error}`);
    }
  }

  async saveResult(result: ResearchResult): Promise<void> {
    try {
      await this.prisma.$queryRawUnsafe(`
        INSERT INTO "MarketSnapshot" (id, "symbol", "timeframe", "source", "payload", "normalized", "createdAt", "fetchedAt")
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      `, `research-result-${result.symbol}-${Date.now()}`, result.symbol, result.timeframe, result.exchange, JSON.stringify(result), JSON.stringify(result));
    } catch (error) {
      this.logger.warn(`Unable to persist research result: ${error instanceof Error ? error.message : error}`);
    }
  }

  async listHistory(symbol: string): Promise<ResearchResult[]> {
    return [];
  }

  async getLatest(symbol: string, timeframe: string, exchange: string): Promise<ResearchResult | null> {
    return null;
  }
}
