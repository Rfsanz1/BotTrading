/**
 * P&L Calculation Service
 * PHASE 2: Profit and Loss calculation and tracking
 * Calculates realized/unrealized P&L, ROI, Sharpe ratio, max drawdown
 */

import { Injectable, Logger } from '@nestjs/common';
import prisma from '@rfsanz/database/src/client';

interface PnLMetrics {
  realizedPnL: number;
  unrealizedPnL: number;
  totalPnL: number;
  totalReturn: number;
  totalReturnPercent: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  averageWin: number;
  averageLoss: number;
  winLossRatio: number;
}

interface DailyPnL {
  date: string;
  pnl: number;
  pnlPercent: number;
  cumulativePnL: number;
}

/**
 * Calculates P&L metrics and performance analytics
 * PHASE 2: Performance tracking
 */
@Injectable()
export class PnLCalculationService {
  private readonly logger = new Logger(PnLCalculationService.name);
  private readonly RISK_FREE_RATE = 0.02; // 2% annual risk-free rate

  /**
   * Calculate total P&L metrics for a user
   * PHASE 2: Main P&L calculation
   */
  async calculatePnLMetrics(userId: string): Promise<PnLMetrics> {
    try {
      this.logger.log(`Calculating P&L metrics for user ${userId}`);

      // Get all positions
      const positions = await prisma.position.findMany({
        where: { userId },
      });

      let realizedPnL = 0;
      let unrealizedPnL = 0;
      let totalCost = 0;
      let totalValue = 0;

      // Calculate realized and unrealized P&L
      for (const pos of positions) {
        const entryPrice = pos.entryPrice.toNumber();
        const quantity = pos.quantity.toNumber();
        const cost = entryPrice * quantity;

        if (pos.status === 'CLOSED') {
          realizedPnL += pos.realizedPnL?.toNumber() || 0;
        } else {
          unrealizedPnL += pos.unrealizedPnL?.toNumber() || 0;
          totalCost += cost;
          totalValue += cost + (pos.unrealizedPnL?.toNumber() || 0);
        }
      }

      const totalPnL = realizedPnL + unrealizedPnL;
      const totalReturn = totalCost > 0 ? totalPnL / totalCost : 0;
      const totalReturnPercent = totalReturn * 100;

      // Get closed positions for statistics
      const closedPositions = positions.filter((p) => p.status === 'CLOSED');

      // Calculate win rate
      const winningPositions = closedPositions.filter(
        (p) => (p.realizedPnL?.toNumber() || 0) > 0,
      );
      const losingPositions = closedPositions.filter(
        (p) => (p.realizedPnL?.toNumber() || 0) < 0,
      );

      const winRate =
        closedPositions.length > 0
          ? (winningPositions.length / closedPositions.length) * 100
          : 0;

      // Calculate profit factor
      const totalWins = winningPositions.reduce(
        (sum, p) => sum + (p.realizedPnL?.toNumber() || 0),
        0,
      );
      const totalLosses = Math.abs(
        losingPositions.reduce((sum, p) => sum + (p.realizedPnL?.toNumber() || 0), 0),
      );
      const profitFactor = totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0;

      // Calculate average win/loss
      const averageWin = winningPositions.length > 0 ? totalWins / winningPositions.length : 0;
      const averageLoss =
        losingPositions.length > 0 ? -totalLosses / losingPositions.length : 0;
      const winLossRatio = averageLoss !== 0 ? Math.abs(averageWin / averageLoss) : 0;

      // Calculate max drawdown and Sharpe ratio (simplified)
      const { maxDrawdown, sharpeRatio } = this.calculateAdvancedMetrics(
        closedPositions,
      );

      return {
        realizedPnL,
        unrealizedPnL,
        totalPnL,
        totalReturn,
        totalReturnPercent,
        winRate,
        profitFactor,
        maxDrawdown,
        sharpeRatio,
        averageWin,
        averageLoss,
        winLossRatio,
      };
    } catch (error) {
      this.logger.error(
        `Failed to calculate P&L metrics: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Calculate daily P&L over a time period
   */
  async calculateDailyPnL(
    userId: string,
    startDate: Date,
    endDate: Date,
  ): Promise<DailyPnL[]> {
    try {
      // Get all closed positions in date range
      const positions = await prisma.position.findMany({
        where: {
          userId,
          status: 'CLOSED',
          closedAt: {
            gte: startDate,
            lte: endDate,
          },
        },
        orderBy: {
          closedAt: 'asc',
        },
      });

      // Group by day
      const byDay = new Map<string, number>();
      let cumulativePnL = 0;

      for (const pos of positions) {
        const date = pos.closedAt!.toISOString().split('T')[0];
        const dayPnL = pos.realizedPnL?.toNumber() || 0;

        byDay.set(date, (byDay.get(date) || 0) + dayPnL);
        cumulativePnL += dayPnL;
      }

      // Convert to array
      const dailyPnLArray: DailyPnL[] = [];

      for (const [date, pnl] of byDay.entries()) {
        dailyPnLArray.push({
          date,
          pnl,
          pnlPercent: 0, // Would need portfolio value to calculate
          cumulativePnL,
        });
      }

      return dailyPnLArray.sort((a, b) =>
        new Date(a.date).getTime() - new Date(b.date).getTime(),
      );
    } catch (error) {
      this.logger.error(
        `Failed to calculate daily P&L: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Calculate advanced metrics (max drawdown, Sharpe ratio)
   */
  private calculateAdvancedMetrics(
    positions: any[],
  ): { maxDrawdown: number; sharpeRatio: number } {
    if (positions.length === 0) {
      return { maxDrawdown: 0, sharpeRatio: 0 };
    }

    // Calculate daily returns
    const returns: number[] = [];
    let cumulativeValue = 1;
    let peakValue = 1;
    let maxDrawdown = 0;

    for (const pos of positions) {
      const pnl = pos.realizedPnL?.toNumber() || 0;
      const cost = pos.entryPrice.toNumber() * pos.quantity.toNumber();

      if (cost > 0) {
        const returnValue = pnl / cost;
        returns.push(returnValue);

        cumulativeValue *= 1 + returnValue;

        // Calculate drawdown
        if (cumulativeValue > peakValue) {
          peakValue = cumulativeValue;
        }

        const drawdown = (peakValue - cumulativeValue) / peakValue;
        if (drawdown > maxDrawdown) {
          maxDrawdown = drawdown;
        }
      }
    }

    // Calculate Sharpe ratio
    let sharpeRatio = 0;
    if (returns.length > 0) {
      const meanReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
      const variance =
        returns.reduce((sum, r) => sum + Math.pow(r - meanReturn, 2), 0) /
        returns.length;
      const stdDev = Math.sqrt(variance);

      if (stdDev > 0) {
        sharpeRatio = (meanReturn - this.RISK_FREE_RATE / 252) / stdDev * Math.sqrt(252);
      }
    }

    return { maxDrawdown, sharpeRatio };
  }

  /**
   * Calculate ROI (Return on Investment) for a position
   */
  calculateROI(
    entryPrice: number,
    exitPrice: number,
    side: 'BUY' | 'SELL',
  ): number {
    if (entryPrice === 0) return 0;

    if (side === 'BUY') {
      return ((exitPrice - entryPrice) / entryPrice) * 100;
    } else {
      return ((entryPrice - exitPrice) / entryPrice) * 100;
    }
  }

  /**
   * Calculate position size based on risk management
   * PHASE 2: Risk-based sizing
   */
  calculatePositionSize(
    accountBalance: number,
    riskPercent: number,
    entryPrice: number,
    stopLossPrice: number,
  ): number {
    if (entryPrice === 0 || accountBalance === 0) return 0;

    const riskAmount = (accountBalance * riskPercent) / 100;
    const priceRisk = Math.abs(entryPrice - stopLossPrice);

    if (priceRisk === 0) return 0;

    return riskAmount / priceRisk;
  }

  /**
   * Calculate position exit prices (take profit levels)
   */
  calculateExitPrices(
    entryPrice: number,
    side: 'BUY' | 'SELL',
    targetRiskReward: number = 2, // 1:2 risk:reward ratio
  ): {
    stopLoss: number;
    takeProfit: number;
  } {
    // Assume stop loss is 1% from entry
    const stopLossPercent = 0.01;

    if (side === 'BUY') {
      const stopLoss = entryPrice * (1 - stopLossPercent);
      const priceRisk = entryPrice - stopLoss;
      const takeProfit = entryPrice + priceRisk * targetRiskReward;

      return { stopLoss, takeProfit };
    } else {
      const stopLoss = entryPrice * (1 + stopLossPercent);
      const priceRisk = stopLoss - entryPrice;
      const takeProfit = entryPrice - priceRisk * targetRiskReward;

      return { stopLoss, takeProfit };
    }
  }

  /**
   * Update trading statistics after trade completion
   */
  async updateTradingStatistics(userId: string): Promise<void> {
    try {
      const metrics = await this.calculatePnLMetrics(userId);

      // Get or create trading statistics record
      const stats = await prisma.tradingStatistics.findUnique({
        where: { userId },
      });

      const positions = await prisma.position.findMany({
        where: { userId, status: 'CLOSED' },
      });

      const closedPositions = positions.filter((p) => p.status === 'CLOSED');
      const winningPositions = closedPositions.filter(
        (p) => (p.realizedPnL?.toNumber() || 0) > 0,
      );
      const losingPositions = closedPositions.filter(
        (p) => (p.realizedPnL?.toNumber() || 0) < 0,
      );

      if (stats) {
        await prisma.tradingStatistics.update({
          where: { userId },
          data: {
            totalTrades: closedPositions.length,
            winningTrades: winningPositions.length,
            losingTrades: losingPositions.length,
            winRate: metrics.winRate,
            totalProfit: metrics.realizedPnL,
            avgWin: metrics.averageWin,
            avgLoss: metrics.averageLoss,
            profitFactor: metrics.profitFactor,
            maxDrawdown: metrics.maxDrawdown,
            sharpeRatio: metrics.sharpeRatio,
          },
        });
      } else {
        await prisma.tradingStatistics.create({
          data: {
            userId,
            totalTrades: closedPositions.length,
            winningTrades: winningPositions.length,
            losingTrades: losingPositions.length,
            winRate: metrics.winRate,
            totalProfit: metrics.realizedPnL,
            avgWin: metrics.averageWin,
            avgLoss: metrics.averageLoss,
            profitFactor: metrics.profitFactor,
            maxDrawdown: metrics.maxDrawdown,
            sharpeRatio: metrics.sharpeRatio,
          },
        });
      }

      this.logger.log(`Updated trading statistics for user ${userId}`);
    } catch (error) {
      this.logger.error(
        `Failed to update trading statistics: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export default PnLCalculationService;
