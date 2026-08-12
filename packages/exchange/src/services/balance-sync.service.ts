/**
 * Balance Sync Service
 * PHASE 2: Balance synchronization with exchange
 * Tracks account balances, updates, and changes over time
 */

import { Injectable, Logger } from '@nestjs/common';
import prisma from '@rfsanz/database/src/client';
import { Decimal } from '@prisma/client/runtime/library';

interface BalanceSnapshot {
  asset: string;
  free: string;
  locked: string;
}

interface BalanceSyncResult {
  exchange: string;
  assets: number;
  totalValue?: number;
  timestamp: Date;
}

/**
 * Synchronizes account balances from exchange
 * PHASE 2: Real-time balance tracking
 */
@Injectable()
export class BalanceSyncService {
  private readonly logger = new Logger(BalanceSyncService.name);

  /**
   * Sync balances from exchange and store in history
   * PHASE 2: Main sync entry point
   */
  async syncBalances(
    userId: string,
    exchangeAdapter: any,
    exchange: string,
  ): Promise<BalanceSyncResult> {
    try {
      this.logger.log(`Syncing balances for ${exchange}...`);

      // Fetch balances from exchange
      const balances = await exchangeAdapter.fetchBalances();

      if (!balances || balances.length === 0) {
        this.logger.warn(`No balances returned from ${exchange}`);
        return {
          exchange,
          assets: 0,
          timestamp: new Date(),
        };
      }

      // Store balance history
      const stored = await Promise.all(
        balances.map((balance: BalanceSnapshot) =>
          this.recordBalance(userId, exchange, balance),
        ),
      );

      this.logger.log(`Synced ${stored.length} assets for ${exchange}`);

      return {
        exchange,
        assets: stored.length,
        timestamp: new Date(),
      };
    } catch (error) {
      this.logger.error(
        `Failed to sync balances: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Record a single balance in history
   */
  private async recordBalance(
    userId: string,
    exchange: string,
    balance: BalanceSnapshot,
  ): Promise<any> {
    try {
      const free = new Decimal(balance.free);
      const locked = new Decimal(balance.locked);
      const total = free.plus(locked);

      const record = await prisma.balanceHistory.create({
        data: {
          userId,
          exchange,
          asset: balance.asset,
          free,
          locked,
          total,
          timestamp: new Date(),
        },
      });

      return record;
    } catch (error) {
      this.logger.error(
        `Failed to record balance for ${balance.asset}: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Get current balances for a user (latest records)
   */
  async getCurrentBalances(userId: string, exchange: string): Promise<any[]> {
    try {
      // Get the latest balance timestamp for this user and exchange
      const latest = await prisma.balanceHistory.findMany({
        where: {
          userId,
          exchange,
        },
        orderBy: {
          timestamp: 'desc',
        },
        take: 1,
      });

      if (latest.length === 0) {
        return [];
      }

      const latestTimestamp = latest[0].timestamp;

      // Get all balances for that timestamp
      return await prisma.balanceHistory.findMany({
        where: {
          userId,
          exchange,
          timestamp: latestTimestamp,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to get current balances: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Get balance history for a specific asset
   */
  async getBalanceHistory(
    userId: string,
    exchange: string,
    asset: string,
    limit: number = 100,
  ): Promise<any[]> {
    try {
      return await prisma.balanceHistory.findMany({
        where: {
          userId,
          exchange,
          asset,
        },
        orderBy: {
          timestamp: 'desc',
        },
        take: limit,
      });
    } catch (error) {
      this.logger.error(
        `Failed to get balance history: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Calculate balance change between two timestamps
   */
  async getBalanceChange(
    userId: string,
    exchange: string,
    asset: string,
    startTime: Date,
    endTime: Date,
  ): Promise<{ startBalance: number; endBalance: number; change: number; changePercent: number } | null> {
    try {
      // Get balance at start time (or closest before)
      const startRecord = await prisma.balanceHistory.findFirst({
        where: {
          userId,
          exchange,
          asset,
          timestamp: {
            lte: startTime,
          },
        },
        orderBy: {
          timestamp: 'desc',
        },
      });

      // Get balance at end time (or closest before)
      const endRecord = await prisma.balanceHistory.findFirst({
        where: {
          userId,
          exchange,
          asset,
          timestamp: {
            lte: endTime,
          },
        },
        orderBy: {
          timestamp: 'desc',
        },
      });

      if (!startRecord || !endRecord) {
        return null;
      }

      const startBalance = startRecord.total.toNumber();
      const endBalance = endRecord.total.toNumber();
      const change = endBalance - startBalance;
      const changePercent = startBalance !== 0 ? (change / startBalance) * 100 : 0;

      return {
        startBalance,
        endBalance,
        change,
        changePercent,
      };
    } catch (error) {
      this.logger.error(
        `Failed to calculate balance change: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Get total portfolio balance in a reference asset (e.g., USDT)
   */
  async getPortfolioBalance(
    userId: string,
    exchange: string,
    priceMap?: Map<string, number>, // Asset -> Price mapping
  ): Promise<number> {
    try {
      const currentBalances = await this.getCurrentBalances(userId, exchange);

      if (currentBalances.length === 0) {
        return 0;
      }

      let totalValue = 0;

      for (const balance of currentBalances) {
        const total = balance.total.toNumber();

        if (balance.asset === 'USDT' || balance.asset === 'USD') {
          // Base currency, add directly
          totalValue += total;
        } else if (priceMap && priceMap.has(balance.asset)) {
          // Multiply by price if available
          const price = priceMap.get(balance.asset) || 0;
          totalValue += total * price;
        } else {
          // Can't calculate value without price
          this.logger.warn(`No price available for ${balance.asset}`);
        }
      }

      return totalValue;
    } catch (error) {
      this.logger.error(
        `Failed to get portfolio balance: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Detect balance changes between syncs
   */
  async detectBalanceChanges(
    userId: string,
    exchange: string,
    threshold: number = 0.001, // 0.1% minimum change to report
  ): Promise<any[]> {
    try {
      const history = await prisma.balanceHistory.findMany({
        where: {
          userId,
          exchange,
        },
        orderBy: {
          timestamp: 'desc',
        },
        take: 200,
      });

      if (history.length < 2) {
        return [];
      }

      // Group by asset
      const byAsset = new Map<string, any[]>();
      for (const record of history) {
        if (!byAsset.has(record.asset)) {
          byAsset.set(record.asset, []);
        }
        byAsset.get(record.asset)!.push(record);
      }

      // Detect changes
      const changes = [];
      for (const [asset, records] of byAsset.entries()) {
        if (records.length >= 2) {
          const latest = records[0];
          const previous = records[1];

          const latestTotal = latest.total.toNumber();
          const previousTotal = previous.total.toNumber();

          if (previousTotal > 0) {
            const changePercent = Math.abs((latestTotal - previousTotal) / previousTotal);
            if (changePercent >= threshold) {
              changes.push({
                asset,
                previous: previousTotal,
                current: latestTotal,
                change: latestTotal - previousTotal,
                changePercent: changePercent * 100,
                timestamp: latest.timestamp,
              });
            }
          }
        }
      }

      return changes;
    } catch (error) {
      this.logger.error(
        `Failed to detect balance changes: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Clean old balance history (keep last N records per asset)
   */
  async cleanOldHistory(
    userId: string,
    exchange: string,
    keepPerAsset: number = 1000,
  ): Promise<number> {
    try {
      const assets = await prisma.balanceHistory.findMany({
        where: {
          userId,
          exchange,
        },
        select: { asset: true },
        distinct: ['asset'],
      });

      let deleted = 0;

      for (const { asset } of assets) {
        // Get records to keep
        const toKeep = await prisma.balanceHistory.findMany({
          where: {
            userId,
            exchange,
            asset,
          },
          orderBy: {
            timestamp: 'desc',
          },
          take: keepPerAsset,
          select: { id: true },
        });

        const keepIds = new Set(toKeep.map((r) => r.id));

        // Delete old records
        const result = await prisma.balanceHistory.deleteMany({
          where: {
            userId,
            exchange,
            asset,
            id: {
              notIn: Array.from(keepIds),
            },
          },
        });

        deleted += result.count;
      }

      this.logger.log(`Cleaned ${deleted} old balance history records`);
      return deleted;
    } catch (error) {
      this.logger.error(
        `Failed to clean balance history: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }
}

export default BalanceSyncService;
