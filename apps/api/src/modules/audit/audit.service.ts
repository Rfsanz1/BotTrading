import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AuditLogRecordedEvent, TradingStatisticsUpdatedEvent, AIPerformanceRecordedEvent } from '../../domain/events';
import { AuditLogRecordingFailedException } from '../../domain/exceptions';
import prisma from '@rfsanz/database/src/client';
import { IAuditLogger } from '../../domain/interfaces';

@Injectable()
export class AuditService implements IAuditLogger {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Log action
   */
  async log(params: { userId: string; action: string; resource: string; changes?: Record<string, any>; ipAddress?: string }): Promise<void> {
    try {
      const auditLog = await prisma.auditLog.create({
        data: {
          userId: params.userId,
          action: params.action,
          resource: params.resource,
          meta: params.changes || {},
          ip: params.ipAddress,
        },
      });

      // Publish event
      const event = new AuditLogRecordedEvent(
        auditLog.id,
        params.userId,
        params.action,
        params.resource,
        params.changes,
        params.ipAddress,
      );
      await this.eventEmitter.emitAsync('trading.audit_log.recorded', event);

      this.logger.log(`Audit log recorded: ${params.action} on ${params.resource}`);
    } catch (error) {
      this.logger.error(`Failed to record audit log: ${error.message}`, error.stack);
      throw new AuditLogRecordingFailedException(error.message);
    }
  }

  /**
   * Log error
   */
  async logError(params: { userId: string; action: string; error: string; ipAddress?: string }): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          userId: params.userId,
          action: params.action,
          resource: 'ERROR',
          meta: { error: params.error },
          ip: params.ipAddress,
        },
      });

      this.logger.warn(`Error logged: ${params.action} - ${params.error}`);
    } catch (error) {
      this.logger.error(`Failed to log error: ${error.message}`);
    }
  }

  /**
   * Get audit logs for user
   */
  async getUserLogs(userId: string, limit: number = 100): Promise<any[]> {
    return prisma.auditLog.findMany({
      where: { userId },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Get audit logs by action
   */
  async getLogsByAction(action: string, limit: number = 100): Promise<any[]> {
    return prisma.auditLog.findMany({
      where: { action },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Update trading statistics
   */
  async updateTradingStats(userId: string, stats: Record<string, any>): Promise<void> {
    try {
      let tradingStats = await prisma.tradingStatistics.findUnique({
        where: { userId },
      });

      if (!tradingStats) {
        tradingStats = await prisma.tradingStatistics.create({
          data: {
            userId,
            ...stats,
          },
        });
      } else {
        tradingStats = await prisma.tradingStatistics.update({
          where: { userId },
          data: stats,
        });
      }

      // Publish event
      const event = new TradingStatisticsUpdatedEvent(
        tradingStats.id,
        userId,
        tradingStats.totalTrades,
        Number(tradingStats.winRate) || 0,
        Number(tradingStats.totalProfit) || 0,
        Number(tradingStats.maxDrawdown) || 0,
      );
      await this.eventEmitter.emitAsync('trading.statistics.updated', event);

      this.logger.log(`Trading statistics updated for user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to update trading statistics: ${error.message}`, error.stack);
    }
  }

  /**
   * Record AI performance
   */
  async recordAIPerformance(params: {
    provider: string;
    symbol: string;
    recommendation: 'BUY' | 'SELL' | 'HOLD';
    accuracy: number;
    profitLoss: number;
  }): Promise<void> {
    try {
      const performance = await prisma.aIPerformance.create({
        data: {
          provider: params.provider as any,
          symbol: params.symbol,
          recommendation: params.recommendation as any,
          accuracy: params.accuracy,
          profitLoss: params.profitLoss,
          isCorrect: params.accuracy > 0.5,
        },
      });

      // Publish event
      const event = new AIPerformanceRecordedEvent(
        performance.id,
        params.provider,
        params.symbol,
        params.recommendation,
        params.accuracy,
        params.profitLoss,
      );
      await this.eventEmitter.emitAsync('trading.ai_performance.recorded', event);

      this.logger.log(`AI performance recorded for ${params.provider} on ${params.symbol}`);
    } catch (error) {
      this.logger.error(`Failed to record AI performance: ${error.message}`, error.stack);
    }
  }

  /**
   * Get AI provider stats
   */
  async getAIProviderStats(provider: string): Promise<any> {
    const performances = await prisma.aIPerformance.findMany({
      where: { provider: provider as any },
      take: 100,
    });

    if (performances.length === 0) {
      return null;
    }

    const correctCount = performances.filter(p => p.isCorrect).length;
    const accuracy = correctCount / performances.length;
    const totalPL = performances.reduce((sum, p) => sum + Number(p.profitLoss || 0), 0);
    const avgAccuracy = performances.reduce((sum, p) => sum + Number(p.accuracy || 0), 0) / performances.length;

    return {
      provider,
      totalTrades: performances.length,
      accuracy,
      totalPnL: totalPL,
      avgAccuracy,
      winRate: correctCount,
    };
  }

  /**
   * Generate trading report
   */
  async generateTradingReport(userId: string): Promise<any> {
    try {
      const stats = await prisma.tradingStatistics.findUnique({
        where: { userId },
      });

      const recentTrades = await prisma.trade.findMany({
        where: { orderId: { in: (await prisma.order.findMany({ where: { userId } })).map(o => o.id) } },
        take: 50,
        orderBy: { timestamp: 'desc' },
      });

      const auditLogs = await this.getUserLogs(userId, 50);

      return {
        userId,
        statistics: stats,
        recentTrades: recentTrades.length,
        auditLogCount: auditLogs.length,
        generatedAt: new Date(),
      };
    } catch (error) {
      this.logger.error(`Failed to generate trading report: ${error.message}`);
      throw error;
    }
  }
}
