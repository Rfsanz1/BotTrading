import { Injectable } from '@nestjs/common';
import { IAnalysisRepository } from '../../../domain/interfaces';
import prisma from '../../../../packages/database/src/client';

@Injectable()
export class AnalysisRepository implements IAnalysisRepository {
  async create(data: Partial<any>): Promise<any> {
    return prisma.analysis.create({
      data: data as any,
    });
  }

  async findById(id: string): Promise<any | null> {
    return prisma.analysis.findUnique({
      where: { id },
    });
  }

  async findAll(query?: Record<string, any>): Promise<any[]> {
    return prisma.analysis.findMany({
      where: query,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(criteria: Partial<any>): Promise<any | null> {
    return prisma.analysis.findFirst({
      where: criteria,
    });
  }

  async update(id: string, data: Partial<any>): Promise<any> {
    return prisma.analysis.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.analysis.delete({
        where: { id },
      });
      return true;
    } catch {
      return false;
    }
  }

  async exists(criteria: Partial<any>): Promise<boolean> {
    const result = await prisma.analysis.findFirst({
      where: criteria,
    });
    return !!result;
  }

  async count(criteria?: Partial<any>): Promise<number> {
    return prisma.analysis.count({
      where: criteria,
    });
  }

  async findByAlertId(alertId: string): Promise<any[]> {
    return prisma.analysis.findMany({
      where: { alertId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findByProvider(provider: string, limit?: number): Promise<any[]> {
    return prisma.analysis.findMany({
      where: { provider },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findBySymbol(symbol: string, limit?: number): Promise<any[]> {
    return prisma.analysis.findMany({
      where: { symbol },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }
}
