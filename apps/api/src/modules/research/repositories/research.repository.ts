import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma.service';
import { ResearchJob, ResearchResult } from '../interfaces/research.interface';
import { toPrismaJson } from '../../market-intelligence/repositories/prisma-json';

@Injectable()
export class ResearchRepository {
  private readonly logger = new Logger(ResearchRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async saveJob(job: ResearchJob): Promise<void> {
    try {
      await this.prisma.marketSnapshot.create({
        data: {
          id: `research-job-${job.id}`,
          symbol: job.symbol,
          timeframe: job.timeframe,
          source: 'research',
          payload: toPrismaJson(job),
          normalized: toPrismaJson(job),
        },
      });
    } catch (error) {
      this.logger.warn(`Unable to persist research job: ${error instanceof Error ? error.message : error}`);
    }
  }

  async updateJobStatus(id: string, status: ResearchJob['status'], result?: ResearchResult): Promise<void> {
    try {
      const payload = { status, result: result ?? null };
      await this.prisma.marketSnapshot.create({
        data: {
          id: `research-result-${id}`,
          symbol: result?.symbol || 'unknown',
          timeframe: result?.timeframe || 'unknown',
          source: 'research-result',
          payload: toPrismaJson(payload),
          normalized: toPrismaJson(payload),
        },
      });
    } catch (error) {
      this.logger.warn(`Unable to update research status: ${error instanceof Error ? error.message : error}`);
    }
  }

  async saveResult(result: ResearchResult): Promise<void> {
    try {
      await this.prisma.marketSnapshot.create({
        data: {
          id: `research-result-${result.symbol}-${Date.now()}`,
          symbol: result.symbol,
          timeframe: result.timeframe,
          source: result.exchange,
          payload: toPrismaJson(result),
          normalized: toPrismaJson(result),
        },
      });
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
