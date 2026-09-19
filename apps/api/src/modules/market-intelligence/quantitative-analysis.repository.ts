import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';
import type { IndicatorBundle } from './services/quantitative-analysis.service';
import { toPrismaJson } from './repositories/prisma-json';

@Injectable()
export class QuantitativeAnalysisRepository {
  private readonly logger = new Logger(QuantitativeAnalysisRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async save(bundle: IndicatorBundle): Promise<any> {
    try {
      return await this.prisma.marketSnapshot.create({
        data: {
          id: `indicator-${Date.now()}`,
          symbol: bundle.symbol,
          timeframe: bundle.timeframe,
          source: bundle.exchange,
          payload: toPrismaJson(bundle),
          normalized: toPrismaJson(bundle.indicators),
        },
      });
    } catch (error) {
      this.logger.warn(`Unable to persist indicator bundle: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  async list(symbol?: string): Promise<any[]> {
    try {
      return await this.prisma.marketSnapshot.findMany({
        where: symbol ? { symbol } : undefined,
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
    } catch (error) {
      this.logger.warn(`Unable to list persisted indicators: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }
}
