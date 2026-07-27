import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

@Injectable()
export class QuantitativeAnalysisRepository {
  private readonly logger = new Logger(QuantitativeAnalysisRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async save(bundle: Record<string, unknown>): Promise<any> {
    try {
      return this.prisma.$queryRawUnsafe(`
        INSERT INTO "MarketSnapshot" (id, "symbol", "timeframe", "source", "payload", "normalized", "createdAt", "fetchedAt")
        VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
        RETURNING *
      `, `indicator-${Date.now()}`, bundle.symbol, bundle.timeframe, bundle.exchange, JSON.stringify(bundle), JSON.stringify(bundle.indicators));
    } catch (error) {
      this.logger.warn(`Unable to persist indicator bundle: ${error instanceof Error ? error.message : error}`);
      return null;
    }
  }

  async list(symbol?: string): Promise<any[]> {
    try {
      const whereClause = symbol ? `WHERE "symbol" = '${symbol}'` : '';
      return this.prisma.$queryRawUnsafe(`SELECT * FROM "MarketSnapshot" ${whereClause} ORDER BY "createdAt" DESC LIMIT 20`);
    } catch (error) {
      this.logger.warn(`Unable to list persisted indicators: ${error instanceof Error ? error.message : error}`);
      return [];
    }
  }
}
