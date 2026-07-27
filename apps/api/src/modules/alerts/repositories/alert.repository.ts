import { Injectable } from '@nestjs/common';
import { IAlertRepository } from '../../../domain/interfaces';
import prisma from '@rfsanz/database/src/client';

@Injectable()
export class AlertRepository implements IAlertRepository {
  async create(data: Partial<any>): Promise<any> {
    return prisma.alert.create({
      data: data as any,
    });
  }

  async findById(id: string): Promise<any | null> {
    return prisma.alert.findUnique({
      where: { id },
      include: {
        analyses: true,
        consensus: true,
        recommendations: true,
      },
    });
  }

  async findAll(query?: Record<string, any>): Promise<any[]> {
    return prisma.alert.findMany({
      where: query,
      orderBy: { receivedAt: 'desc' },
    });
  }

  async findOne(criteria: Partial<any>): Promise<any | null> {
    return prisma.alert.findFirst({
      where: criteria,
    });
  }

  async update(id: string, data: Partial<any>): Promise<any> {
    return prisma.alert.update({
      where: { id },
      data,
    });
  }

  async delete(id: string): Promise<boolean> {
    try {
      await prisma.alert.delete({
        where: { id },
      });
      return true;
    } catch {
      return false;
    }
  }

  async exists(criteria: Partial<any>): Promise<boolean> {
    const result = await prisma.alert.findFirst({
      where: criteria,
    });
    return !!result;
  }

  async count(criteria?: Partial<any>): Promise<number> {
    return prisma.alert.count({
      where: criteria,
    });
  }

  async findByUserId(userId: string, limit?: number, offset?: number): Promise<any[]> {
    return prisma.alert.findMany({
      where: { userId },
      take: limit,
      skip: offset,
      orderBy: { receivedAt: 'desc' },
      include: {
        analyses: true,
        consensus: true,
        recommendations: true,
      },
    });
  }

  async findBySymbol(symbol: string, limit?: number): Promise<any[]> {
    return prisma.alert.findMany({
      where: { symbol },
      take: limit,
      orderBy: { receivedAt: 'desc' },
    });
  }

  async findByStatus(status: string, limit?: number): Promise<any[]> {
    return prisma.alert.findMany({
      where: { status },
      take: limit,
      orderBy: { receivedAt: 'desc' },
    });
  }

  async updateStatus(id: string, status: string): Promise<any> {
    return prisma.alert.update({
      where: { id },
      data: {
        status,
        validatedAt: status === 'VALIDATED' ? new Date() : undefined,
      },
    });
  }
}
