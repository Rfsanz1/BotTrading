/**
 * Position Service
 * PHASE 2: Position lifecycle management
 * Tracks entry/exit points, P&L calculation, position size management
 */

import { Injectable, Logger } from '@nestjs/common';
import { Decimal } from '@prisma/client/runtime/library';
import prisma from '@rfsanz/database/src/client';
import { createExchange } from '../factory';
import { ExchangeName } from '../factory';

interface PositionParams {
  userId: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  entryPrice: number;
  quantity: number;
  portfolioId?: string;
  stopLoss?: number;
  takeProfit?: number;
  meta?: any;
}

interface PositionMetrics {
  unrealizedPnL: number;
  unrealizedPnLPercent: number;
  realizedPnL: number;
  totalPnL: number;
  quantity: number;
  currentPrice?: number;
}

/**
 * Manages position lifecycle and P&L calculation
 * PHASE 2: Complete position tracking
 */
@Injectable()
export class PositionService {
  private readonly logger = new Logger(PositionService.name);

  /**
   * List open positions on exchange
   * Legacy compatibility method
   */
  async listOpen(accountId: string, exchange: ExchangeName) {
    const ex = createExchange(exchange);
    await ex.connect({ id: accountId, userId: 'system', exchange, isActive: true });
    const pos = await ex.fetchOpenPositions();
    await ex.disconnect();
    return pos;
  }

  /**
   * Open a new position
   * PHASE 2: Initial position creation
   */
  async openPosition(params: PositionParams): Promise<string> {
    try {
      this.logger.log(
        `Opening ${params.side} position for ${params.symbol}: qty=${params.quantity} @ ${params.entryPrice}`,
      );

      const position = await prisma.position.create({
        data: {
          userId: params.userId,
          portfolioId: params.portfolioId,
          symbol: params.symbol,
          side: params.side === 'BUY' ? 'BUY' : 'SELL',
          entryPrice: new Decimal(params.entryPrice),
          quantity: new Decimal(params.quantity),
          stopLoss: params.stopLoss ? new Decimal(params.stopLoss) : null,
          takeProfit: params.takeProfit ? new Decimal(params.takeProfit) : null,
          status: 'OPEN',
          meta: params.meta || {},
        },
      });

      this.logger.log(`Position created: ${position.id}`);
      return position.id;
    } catch (error) {
      throw new Error(
        `Failed to open position: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Calculate unrealized P&L for a position
   * PHASE 2: Real-time P&L calculation
   */
  calculateUnrealizedPnL(
    entryPrice: number,
    currentPrice: number,
    quantity: number,
    side: 'BUY' | 'SELL',
  ): number {
    if (side === 'BUY') {
      // For BUY positions: profit when price rises
      return (currentPrice - entryPrice) * quantity;
    } else {
      // For SELL positions: profit when price falls
      return (entryPrice - currentPrice) * quantity;
    }
  }

  /**
   * Calculate unrealized P&L percentage
   */
  calculateUnrealizedPnLPercent(
    entryPrice: number,
    currentPrice: number,
    side: 'BUY' | 'SELL',
  ): number {
    if (entryPrice === 0) return 0;

    if (side === 'BUY') {
      return ((currentPrice - entryPrice) / entryPrice) * 100;
    } else {
      return ((entryPrice - currentPrice) / entryPrice) * 100;
    }
  }

  /**
   * Update position with current market price
   * PHASE 2: Real-time price updates
   */
  async updatePositionMetrics(
    positionId: string,
    currentPrice: number,
  ): Promise<PositionMetrics> {
    try {
      const position = await prisma.position.findUnique({
        where: { id: positionId },
      });

      if (!position || position.status !== 'OPEN') {
        throw new Error(`Position ${positionId} not found or not open`);
      }

      const entryPrice = position.entryPrice.toNumber();
      const quantity = position.quantity.toNumber();
      const side = position.side as 'BUY' | 'SELL';

      const unrealizedPnL = this.calculateUnrealizedPnL(
        entryPrice,
        currentPrice,
        quantity,
        side,
      );

      const unrealizedPnLPercent = this.calculateUnrealizedPnLPercent(
        entryPrice,
        currentPrice,
        side,
      );

      // Update database
      await prisma.position.update({
        where: { id: positionId },
        data: {
          unrealizedPnL: new Decimal(unrealizedPnL),
          meta: {
            ...position.meta,
            lastUpdatedPrice: currentPrice,
            lastUpdatedAt: new Date().toISOString(),
          },
        },
      });

      const realizedPnL = position.realizedPnL?.toNumber() || 0;

      return {
        unrealizedPnL,
        unrealizedPnLPercent,
        realizedPnL,
        totalPnL: unrealizedPnL + realizedPnL,
        quantity,
        currentPrice,
      };
    } catch (error) {
      throw new Error(
        `Failed to update position metrics: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Check if position should be closed based on stop-loss or take-profit
   * PHASE 2: Exit condition checking
   */
  async checkExitConditions(
    positionId: string,
    currentPrice: number,
  ): Promise<{ shouldClose: boolean; reason?: string }> {
    try {
      const position = await prisma.position.findUnique({
        where: { id: positionId },
      });

      if (!position || position.status !== 'OPEN') {
        return { shouldClose: false };
      }

      const stopLoss = position.stopLoss?.toNumber();
      const takeProfit = position.takeProfit?.toNumber();
      const side = position.side as 'BUY' | 'SELL';

      // Check stop-loss
      if (stopLoss) {
        if (side === 'BUY' && currentPrice <= stopLoss) {
          return { shouldClose: true, reason: 'STOP_LOSS_HIT' };
        }
        if (side === 'SELL' && currentPrice >= stopLoss) {
          return { shouldClose: true, reason: 'STOP_LOSS_HIT' };
        }
      }

      // Check take-profit
      if (takeProfit) {
        if (side === 'BUY' && currentPrice >= takeProfit) {
          return { shouldClose: true, reason: 'TAKE_PROFIT_HIT' };
        }
        if (side === 'SELL' && currentPrice <= takeProfit) {
          return { shouldClose: true, reason: 'TAKE_PROFIT_HIT' };
        }
      }

      return { shouldClose: false };
    } catch (error) {
      this.logger.error(`Failed to check exit conditions: ${error}`);
      return { shouldClose: false };
    }
  }

  /**
   * Close a position (mark as CLOSED, record realized P&L)
   * PHASE 2: Position exit handling
   */
  async closePosition(
    positionId: string,
    closingPrice: number,
    reason?: string,
  ): Promise<void> {
    try {
      const position = await prisma.position.findUnique({
        where: { id: positionId },
      });

      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      const entryPrice = position.entryPrice.toNumber();
      const quantity = position.quantity.toNumber();
      const side = position.side as 'BUY' | 'SELL';

      // Calculate realized P&L
      const realizedPnL = this.calculateUnrealizedPnL(
        entryPrice,
        closingPrice,
        quantity,
        side,
      );

      this.logger.log(
        `Closing position ${positionId}: realized P&L = ${realizedPnL} (reason: ${reason || 'MANUAL'})`,
      );

      // Update position status to CLOSED
      await prisma.position.update({
        where: { id: positionId },
        data: {
          status: 'CLOSED',
          realizedPnL: new Decimal(realizedPnL),
          closedAt: new Date(),
          meta: {
            ...position.meta,
            closingPrice,
            closingReason: reason || 'MANUAL',
            closedAt: new Date().toISOString(),
          },
        },
      });

      this.logger.log(`Position ${positionId} closed successfully`);
    } catch (error) {
      throw new Error(
        `Failed to close position: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get all open positions for a user
   */
  async getOpenPositions(userId: string): Promise<any[]> {
    try {
      return await prisma.position.findMany({
        where: {
          userId,
          status: 'OPEN',
        },
        orderBy: {
          openedAt: 'desc',
        },
      });
    } catch (error) {
      throw new Error(
        `Failed to get open positions: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Get all closed positions for a user
   */
  async getClosedPositions(userId: string): Promise<any[]> {
    try {
      return await prisma.position.findMany({
        where: {
          userId,
          status: 'CLOSED',
        },
        orderBy: {
          closedAt: 'desc',
        },
      });
    } catch (error) {
      throw new Error(
        `Failed to get closed positions: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Calculate total portfolio P&L
   * PHASE 2: Portfolio-level P&L
   */
  async getPortfolioPnL(userId: string): Promise<{
    totalUnrealizedPnL: number;
    totalRealizedPnL: number;
    totalPnL: number;
    winRate: number;
  }> {
    try {
      const positions = await prisma.position.findMany({
        where: { userId },
      });

      let totalUnrealizedPnL = 0;
      let totalRealizedPnL = 0;

      for (const pos of positions) {
        totalUnrealizedPnL += pos.unrealizedPnL?.toNumber() || 0;
        totalRealizedPnL += pos.realizedPnL?.toNumber() || 0;
      }

      // Calculate win rate
      const closedPositions = positions.filter((p) => p.status === 'CLOSED');
      const winningPositions = closedPositions.filter(
        (p) => (p.realizedPnL?.toNumber() || 0) > 0,
      );

      const winRate =
        closedPositions.length > 0
          ? (winningPositions.length / closedPositions.length) * 100
          : 0;

      return {
        totalUnrealizedPnL,
        totalRealizedPnL,
        totalPnL: totalUnrealizedPnL + totalRealizedPnL,
        winRate,
      };
    } catch (error) {
      throw new Error(
        `Failed to calculate portfolio P&L: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export default new PositionService();
