import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma.service';
import { toPrismaJson } from './prisma-json';

@Injectable()
export class MarketRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createSnapshot(data: {
    id: string;
    symbol: string;
    timeframe: string;
    source: string;
    payload: Record<string, unknown>;
    normalized: Record<string, unknown>;
  }): Promise<any> {
    return this.prisma.marketSnapshot.create({
      data: {
        id: data.id,
        symbol: data.symbol,
        timeframe: data.timeframe,
        source: data.source,
        payload: toPrismaJson(data.payload),
        normalized: toPrismaJson(data.normalized),
      },
    });
  }

  async findRecent(symbol: string, timeframe: string, source?: string): Promise<any[]> {
    return this.prisma.marketSnapshot.findMany({
      where: {
        symbol,
        timeframe,
        ...(source ? { source } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  async updateSnapshot(
    id: string,
    data: {
      payload?: Record<string, unknown>;
      normalized?: Record<string, unknown>;
    },
  ): Promise<any> {
    return this.prisma.marketSnapshot.update({
      where: { id },
      data: {
        ...(data.payload === undefined ? {} : { payload: toPrismaJson(data.payload) }),
        ...(data.normalized === undefined ? {} : { normalized: toPrismaJson(data.normalized) }),
      },
    });
  }
}
