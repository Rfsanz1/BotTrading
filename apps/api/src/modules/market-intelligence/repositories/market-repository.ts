import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma.service';

@Injectable()
export class MarketRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createSnapshot(data: Record<string, unknown>): Promise<any> {
    return this.prisma.$queryRawUnsafe(`
      INSERT INTO "MarketSnapshot" (id, "symbol", "timeframe", "source", "payload", "normalized", "createdAt", "fetchedAt")
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
      RETURNING *
    `, data.id, data.symbol, data.timeframe, data.source, JSON.stringify(data.payload), JSON.stringify(data.normalized));
  }

  async findRecent(symbol: string, timeframe: string, source?: string): Promise<any[]> {
    return this.prisma.$queryRawUnsafe(`
      SELECT * FROM "MarketSnapshot"
      WHERE "symbol" = $1 AND "timeframe" = $2 AND ($3::text IS NULL OR "source" = $3)
      ORDER BY "createdAt" DESC
      LIMIT 20
    `, symbol, timeframe, source ?? null);
  }
}
