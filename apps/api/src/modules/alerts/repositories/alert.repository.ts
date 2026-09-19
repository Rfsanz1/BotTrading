import { Injectable } from '@nestjs/common';
import { IAlertRepository } from '../../../domain/interfaces';
import prisma from '@rfsanz/database';
import { AlertStatus } from '@prisma/client';

function toAlertStatus(status: string): AlertStatus {
  if (Object.values(AlertStatus).includes(status as AlertStatus)) {
    return status as AlertStatus;
  }
  throw new Error(`Invalid alert status: ${status}`);
}

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
      where: { status: toAlertStatus(status) },
      take: limit,
      orderBy: { receivedAt: 'desc' },
    });
  }

  async updateStatus(id: string, status: string): Promise<any> {
    const alertStatus = toAlertStatus(status);
    return prisma.alert.update({
      where: { id },
      data: {
        status: alertStatus,
        validatedAt: alertStatus === AlertStatus.VALIDATED ? new Date() : undefined,
      },
    });
  }
}
