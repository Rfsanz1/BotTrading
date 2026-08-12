import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import prisma from '@rfsanz/database/src/client';
import { SymbolValidator } from '@rfsanz/exchange/src/services/symbol-validator.service';
import { PositionService } from '@rfsanz/exchange/src/services/position.service';
import { BalanceSyncService } from '@rfsanz/exchange/src/services/balance-sync.service';
import { PnLCalculationService } from '@rfsanz/exchange/src/services/pnl-calculation.service';
import {
  OrderValidationStartedEvent,
  PositionSizeCalculatedEvent,
  OrderSubmittedToExchangeEvent,
  OrderFilledEvent,
  TradeRecordedEvent,
  PositionUpdatedEvent,
  OrderFailedEvent,
} from '../../domain/events';
import {
  OrderNotFoundException,
  OrderCreationFailedException,
  OrderValidationFailedException,
  PositionSizeCalculationFailedException,
  RiskLimitExceededException,
} from '../../domain/exceptions';

@Injectable()
export class TradingService {
  private readonly logger = new Logger(TradingService.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly symbolValidator: SymbolValidator,
    public readonly positionService: PositionService,
    public readonly balanceSyncService: BalanceSyncService,
    public readonly pnlCalculationService: PnLCalculationService,
  ) {}

  /**
   * Create order from recommendation
   */
  async createOrder(params: {
    userId: string;
    recommendationId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    exchange: string;
    stopLoss?: number;
    targetPrice?: number;
  }): Promise<string> {
    try {
      this.logger.log(`Creating order for ${params.symbol} - ${params.side} ${params.quantity} @ ${params.price}`);

      // Validate order
      this.validateOrder(params);

      // Create order in database
      const order = await prisma.order.create({
        data: {
          userId: params.userId,
          symbol: params.symbol,
          side: params.side as any,
          quantity: params.quantity,
          price: params.price,
          exchange: params.exchange,
          status: 'NEW',
          meta: {
            recommendationId: params.recommendationId,
            stopLoss: params.stopLoss,
            targetPrice: params.targetPrice,
            createdAt: new Date(),
          },
        },
      });

      // Link order to recommendation
      await prisma.orderAnalysisLink.create({
        data: {
          orderId: order.id,
          alertId: (await this.getRecommendationAlert(params.recommendationId)).id,
          recommendationId: params.recommendationId,
        },
      });

      // Publish event
      const event = new OrderValidationStartedEvent(
        order.id,
        params.userId,
        params.symbol,
        params.quantity,
        params.price,
      );
      await this.eventEmitter.emitAsync('trading.order.validation_started', event);

      this.logger.log(`Order created: ${order.id}`);
      return order.id;
    } catch (error) {
      this.logger.error(`Failed to create order: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Calculate position size based on risk
   */
  async calculatePositionSize(params: {
    orderId: string;
    entryPrice: number;
    stopLoss: number;
    accountBalance: number;
    riskPercentage: number;
  }): Promise<{ quantity: number; riskAmount: number }> {
    try {
      // Validate inputs
      if (params.riskPercentage < 0.1 || params.riskPercentage > 10) {
        throw new PositionSizeCalculationFailedException('Risk percentage must be between 0.1% and 10%');
      }

      if (params.entryPrice <= 0 || params.stopLoss < 0) {
        throw new PositionSizeCalculationFailedException('Invalid price values');
      }

      const riskAmount = (params.accountBalance * params.riskPercentage) / 100;
      const priceDistance = Math.abs(params.entryPrice - params.stopLoss);

      if (priceDistance === 0) {
        throw new PositionSizeCalculationFailedException('Entry price and stop loss cannot be the same');
      }

      const quantity = riskAmount / priceDistance;

      // Update order with calculated position size
      await prisma.order.update({
        where: { id: params.orderId },
        data: {
          quantity,
          meta: {
            calculatedQuantity: quantity,
            riskAmount,
          },
        },
      });

      // Publish event
      const order = await prisma.order.findUnique({ where: { id: params.orderId } });
      const event = new PositionSizeCalculatedEvent(
        params.orderId,
        order!.userId,
        order!.symbol,
        quantity,
        riskAmount,
        (quantity * params.entryPrice) / params.accountBalance,
      );
      await this.eventEmitter.emitAsync('trading.position_size.calculated', event);

      this.logger.log(`Position size calculated: ${quantity} units for order ${params.orderId}`);

      return { quantity, riskAmount };
    } catch (error) {
      this.logger.error(`Failed to calculate position size: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Submit order to exchange
   * PHASE 1: Real exchange execution
   */
  async submitToExchange(orderId: string): Promise<{ success: boolean; externalOrderId?: string }> {
    let exchangeAdapter: any = null;
    
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: {
            include: {
              exchangeAccounts: {
                where: {
                  exchange: order?.exchange,
                  isActive: true,
                },
                include: {
                  apiKeys: {
                    where: { revoked: false },
                  },
                },
              },
            },
          },
        },
      });

      if (!order) {
        throw new OrderNotFoundException(orderId);
      }

      if (order.status !== 'NEW') {
        throw new OrderValidationFailedException(`Order status must be NEW, current: ${order.status}`);
      }

      this.logger.log(`Submitting order ${orderId} to exchange ${order.exchange}`);

      // ═══════════════════════════════════════════════════════════
      // SAFETY CHECK 1: Verify minimum account balance
      // ═══════════════════════════════════════════════════════════
      const minBalance = Number(process.env.TRADING_MIN_ACCOUNT_BALANCE_USD || 50);
      const userBalance = await this.balanceSyncService.getPortfolioBalance(
        order.userId,
        order.exchange,
      );
      if (userBalance < minBalance) {
        throw new RiskLimitExceededException(
          `Account balance $${userBalance} below minimum $${minBalance}`,
        );
      }

      // ═══════════════════════════════════════════════════════════
      // SAFETY CHECK 2: Verify maximum order value
      // ═══════════════════════════════════════════════════════════
      const maxOrderValue = Number(process.env.TRADING_MAX_ORDER_VALUE_USD || 500);
      const orderValue = order.quantity * (order.price || 0);
      if (orderValue > maxOrderValue) {
        throw new RiskLimitExceededException(
          `Order value $${orderValue.toFixed(2)} exceeds maximum $${maxOrderValue}`,
        );
      }

      // ═══════════════════════════════════════════════════════════
      // SAFETY CHECK 3: Check daily loss limit
      // ═══════════════════════════════════════════════════════════
      const dailyLossLimit = Number(process.env.TRADING_DAILY_LOSS_LIMIT_USD || 1000);
      const dailyMetrics = await this.pnlCalculationService.calculatePnLMetrics(order.userId);
      if (dailyMetrics.realizedPnL < -dailyLossLimit) {
        this.logger.warn(
          `User ${order.userId} hit daily loss limit: $${dailyMetrics.realizedPnL}`,
        );
        throw new RiskLimitExceededException(
          `Daily loss limit reached: $${dailyLossLimit}. Current loss: $${dailyMetrics.realizedPnL}`,
        );
      }

      // ═══════════════════════════════════════════════════════════
      // SAFETY CHECK 4: Verify maximum position size
      // ═══════════════════════════════════════════════════════════
      const maxPositionPercent = Number(
        process.env.TRADING_MAX_POSITION_SIZE_PERCENT || 10,
      );
      const positionPercent = (orderValue / userBalance) * 100;
      if (positionPercent > maxPositionPercent) {
        throw new RiskLimitExceededException(
          `Position size ${positionPercent.toFixed(2)}% exceeds maximum ${maxPositionPercent}%`,
        );
      }

      // ═══════════════════════════════════════════════════════════
      // SAFETY CHECK 5: Check maximum concurrent positions
      // ═══════════════════════════════════════════════════════════
      const maxConcurrentPositions = Number(
        process.env.TRADING_MAX_CONCURRENT_POSITIONS || 5,
      );
      const openPositions = await this.positionService.getOpenPositions(order.userId);
      if ((openPositions?.length || 0) >= maxConcurrentPositions) {
        throw new RiskLimitExceededException(
          `Maximum concurrent positions (${maxConcurrentPositions}) already open`,
        );
      }

      this.logger.log(
        `Safety checks passed for order ${orderId}. Value: $${orderValue}, Balance: $${userBalance}`,
      );

      // Check for idempotency: if order already has externalId, don't resubmit
      if (order.externalId) {
        this.logger.warn(`Order ${orderId} already has external ID: ${order.externalId}, skipping resubmission`);
        return { success: true, externalOrderId: order.externalId };
      }

      // Get exchange account credentials
      const exchangeAccount = order.user?.exchangeAccounts?.[0];
      if (!exchangeAccount) {
        throw new OrderValidationFailedException(
          `No active exchange account found for ${order.exchange}`,
        );
      }

      // Build credentials from ApiKeys
      let credentials: any = null;
      if (exchangeAccount.apiKeys && exchangeAccount.apiKeys.length > 0) {
        const apiKey = exchangeAccount.apiKeys[0];
        credentials = {
          apiKey: apiKey.keyHash, // TODO: In production, decrypt the actual key
          apiSecret: apiKey.secretEncrypted, // TODO: In production, decrypt the secret
        };
      }

      // Get exchange adapter (in production, this would come from dependency injection)
      const { createExchange } = await import('@rfsanz/exchange/src/factory');
      
      const account = {
        id: exchangeAccount.id,
        userId: order.user!.id,
        exchange: order.exchange,
        accountId: exchangeAccount.accountId,
        credentials,
        isActive: exchangeAccount.isActive,
        isPaper: process.env.BINANCE_USE_TESTNET !== 'false', // Default to testnet
      };

      exchangeAdapter = createExchange(order.exchange as any, account);
      await exchangeAdapter.connect(account);

      // Validate and fix order parameters (PHASE 1: LOT_SIZE, MIN_NOTIONAL, PRICE_FILTER)
      const orderParams = {
        symbol: order.symbol,
        side: order.side.toLowerCase() as 'buy' | 'sell',
        type: 'limit',
        quantity: order.quantity.toString(),
        price: order.price?.toString(),
        clientOrderId: `${order.id}-${Date.now()}`, // Idempotency key
        timeInForce: 'GTC',
      };

      // Validate against symbol filters
      const validatedParams = await this.symbolValidator.validateAndFixOrderParams(
        exchangeAdapter,
        order.symbol,
        orderParams,
      );

      // Submit order to exchange
      const exchangeOrder = await exchangeAdapter.placeOrder(validatedParams);

      // Store external order ID
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'PENDING', // Changed from NEW to PENDING (waiting for exchange confirmation)
          externalId: exchangeOrder.externalId || exchangeOrder.id,
          meta: {
            ...order.meta,
            externalOrderId: exchangeOrder.externalId || exchangeOrder.id,
            clientOrderId: exchangeOrder.clientOrderId,
            submittedAt: new Date().toISOString(),
            exchangeResponse: {
              price: exchangeOrder.price,
              quantity: exchangeOrder.quantity,
              filled: exchangeOrder.filled,
              status: exchangeOrder.status,
            },
          },
        },
      });

      // Publish event
      const event = new OrderSubmittedToExchangeEvent(
        orderId,
        order.userId,
        order.exchange,
        exchangeOrder.externalId || exchangeOrder.id,
        order.symbol,
        order.side as any,
        order.quantity,
        order.price || 0,
      );
      await this.eventEmitter.emitAsync('trading.order.submitted_to_exchange', event);

      this.logger.log(
        `Order submitted to ${order.exchange}: internal=${orderId}, external=${exchangeOrder.externalId || exchangeOrder.id}`,
      );

      return { success: true, externalOrderId: exchangeOrder.externalId || exchangeOrder.id };
    } catch (error) {
      this.logger.error(
        `Failed to submit order to exchange: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : '',
      );

      // Publish failure event
      const order = await prisma.order
        .findUnique({ where: { id: orderId } })
        .catch(() => null);
      if (order) {
        const failEvent = new OrderFailedEvent(
          orderId,
          order.userId,
          order.symbol,
          error instanceof Error ? error.message : String(error),
        );
        await this.eventEmitter
          .emitAsync('trading.order.failed', failEvent)
          .catch(() => {});
      }

      throw error;
    } finally {
      // Clean up exchange adapter connection
      if (exchangeAdapter) {
        try {
          await exchangeAdapter.disconnect();
        } catch (error) {
          this.logger.warn(
            `Error disconnecting from exchange: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  /**
   * Record trade execution
   */
  async recordTrade(params: {
    orderId: string;
    filledQuantity: number;
    filledPrice: number;
    fee: number;
  }): Promise<string> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: params.orderId },
      });

      if (!order) {
        throw new OrderNotFoundException(params.orderId);
      }

      // Create trade record
      const trade = await prisma.trade.create({
        data: {
          orderId: params.orderId,
          price: params.filledPrice,
          quantity: params.filledQuantity,
          fee: params.fee,
          side: order.side as any,
        },
      });

      // Update order status
      await prisma.order.update({
        where: { id: params.orderId },
        data: {
          filled: params.filledQuantity,
          status: 'FILLED',
        },
      });

      // Publish events
      const tradeEvent = new TradeRecordedEvent(
        trade.id,
        params.orderId,
        order.userId,
        order.symbol,
        order.side as any,
        params.filledQuantity,
        params.filledPrice,
        params.fee,
      );
      await this.eventEmitter.emitAsync('trading.trade.recorded', tradeEvent);

      // Update position
      await this.updatePosition(order.userId, order.symbol, order.side as 'BUY' | 'SELL', params.filledQuantity, params.filledPrice);

      this.logger.log(`Trade recorded: ${trade.id} for order ${params.orderId}`);

      return trade.id;
    } catch (error) {
      this.logger.error(`Failed to record trade: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Update position after trade
   */
  private async updatePosition(
    userId: string,
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    price: number,
  ): Promise<void> {
    try {
      // Find or create position
      let position = await prisma.position.findFirst({
        where: {
          userId,
          symbol,
          status: 'OPEN',
        },
      });

      if (!position) {
        // Create new position
        position = await prisma.position.create({
          data: {
            userId,
            symbol,
            side,
            quantity,
            entryPrice: price,
            status: 'OPEN',
          },
        });
      } else {
        // Update existing position
        if (side === position.side) {
          // Same direction: increase position
          const newQuantity = position.quantity + quantity;
          const newEntryPrice = (position.quantity * position.entryPrice + quantity * price) / newQuantity;

          position = await prisma.position.update({
            where: { id: position.id },
            data: {
              quantity: newQuantity,
              entryPrice: newEntryPrice,
            },
          });
        } else {
          // Opposite direction: decrease or close position
          const newQuantity = position.quantity - quantity;

          if (newQuantity <= 0) {
            // Close position
            position = await prisma.position.update({
              where: { id: position.id },
              data: {
                quantity: 0,
                status: 'CLOSED',
                closedAt: new Date(),
                realizedPnL: (price - position.entryPrice) * quantity,
              },
            });
          } else {
            // Partial close
            position = await prisma.position.update({
              where: { id: position.id },
              data: {
                quantity: newQuantity,
              },
            });
          }
        }
      }

      // Publish position updated event
      const event = new PositionUpdatedEvent(
        position.id,
        userId,
        symbol,
        side,
        position.quantity,
        position.entryPrice,
      );
      await this.eventEmitter.emitAsync('trading.position.updated', event);

      this.logger.log(`Position updated: ${symbol} ${side} ${position.quantity} units`);
    } catch (error) {
      this.logger.error(`Failed to update position: ${error.message}`, error.stack);
    }
  }

  /**
   * Get order by ID
   */
  async getOrder(orderId: string): Promise<any> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        trades: true,
        analysisLinks: true,
      },
    });

    if (!order) {
      throw new OrderNotFoundException(orderId);
    }

    return order;
  }

  /**
   * Validate order
   */
  private validateOrder(params: any): void {
    if (!params.symbol || params.symbol.trim().length === 0) {
      throw new OrderCreationFailedException('Symbol is required');
    }

    if (!['BUY', 'SELL'].includes(params.side)) {
      throw new OrderCreationFailedException('Invalid side: must be BUY or SELL');
    }

    if (params.quantity <= 0) {
      throw new OrderCreationFailedException('Quantity must be greater than 0');
    }

    if (params.price <= 0) {
      throw new OrderCreationFailedException('Price must be greater than 0');
    }
  }

  /**
   * Sync order status from exchange
   * PHASE 1: Order status tracking
   */
  async syncOrderStatus(orderId: string): Promise<void> {
    let exchangeAdapter: any = null;

    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: {
            include: {
              exchangeAccounts: {
                where: {
                  exchange: order?.exchange,
                  isActive: true,
                },
                include: {
                  apiKeys: {
                    where: { revoked: false },
                  },
                },
              },
            },
          },
        },
      });

      if (!order) {
        throw new OrderNotFoundException(orderId);
      }

      if (!order.externalId) {
        this.logger.warn(`Order ${orderId} has no external ID, skipping sync`);
        return;
      }

      // Get exchange adapter
      const { createExchange } = await import('@rfsanz/exchange/src/factory');
      const exchangeAccount = order.user?.exchangeAccounts?.[0];

      if (!exchangeAccount) {
        throw new OrderValidationFailedException(
          `No active exchange account found for ${order.exchange}`,
        );
      }

      const credentials = exchangeAccount.apiKeys?.[0] && {
        apiKey: exchangeAccount.apiKeys[0].keyHash,
        apiSecret: exchangeAccount.apiKeys[0].secretEncrypted,
      };

      const account = {
        id: exchangeAccount.id,
        userId: order.user!.id,
        exchange: order.exchange,
        accountId: exchangeAccount.accountId,
        credentials,
        isActive: exchangeAccount.isActive,
        isPaper: process.env.BINANCE_USE_TESTNET !== 'false',
      };

      exchangeAdapter = createExchange(order.exchange as any, account);
      await exchangeAdapter.connect(account);

      // Get order status from exchange
      const exchangeOrder = await exchangeAdapter.getOrder(order.externalId);

      if (!exchangeOrder) {
        this.logger.warn(`Order ${order.externalId} not found on exchange`);
        return;
      }

      // Update order with exchange status
      await this.updateOrderFromExchange(order, exchangeOrder);
    } catch (error) {
      this.logger.error(
        `Failed to sync order status: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : '',
      );
    } finally {
      if (exchangeAdapter) {
        try {
          await exchangeAdapter.disconnect();
        } catch (error) {
          this.logger.warn(
            `Error disconnecting from exchange: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  /**
   * Update local order from exchange order data
   */
  private async updateOrderFromExchange(localOrder: any, exchangeOrder: any): Promise<void> {
    const statusMap: Record<string, string> = {
      NEW: 'PENDING',
      PARTIALLY_FILLED: 'PARTIALLY_FILLED',
      FILLED: 'FILLED',
      CANCELED: 'CANCELED',
      REJECTED: 'REJECTED',
      EXPIRED: 'CANCELED',
    };

    const mappedStatus = statusMap[exchangeOrder.status] || exchangeOrder.status;

    // Check if order has been partially or fully filled
    const previousFilled = localOrder.filled || 0;
    const currentFilled = parseFloat(exchangeOrder.filled);
    const newlyFilled = currentFilled - previousFilled;

    if (newlyFilled > 0) {
      // Record partial/full fill
      await this.recordTrade({
        orderId: localOrder.id,
        filledQuantity: newlyFilled,
        filledPrice: parseFloat(exchangeOrder.price || localOrder.price),
        fee: 0, // TODO: Get actual fee from exchange
      });
    }

    // Update order status if changed
    if (mappedStatus !== localOrder.status) {
      await prisma.order.update({
        where: { id: localOrder.id },
        data: {
          status: mappedStatus,
          filled: currentFilled,
          meta: {
            ...localOrder.meta,
            lastSyncedAt: new Date().toISOString(),
            exchangeStatus: exchangeOrder.status,
          },
        },
      });

      this.logger.log(
        `Order ${localOrder.id} status changed from ${localOrder.status} to ${mappedStatus}`,
      );
    }
  }

  /**
   * Reconcile all open orders with exchange
   * PHASE 1: Startup reconciliation
   * Called at application startup to repair any inconsistencies between local and exchange state
   */
  async reconcileOpenOrders(userId: string, exchange: string): Promise<void> {
    let exchangeAdapter: any = null;

    try {
      this.logger.log(`Starting reconciliation for ${exchange} user ${userId}`);

      // Get user's exchange account
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          exchangeAccounts: {
            where: {
              exchange,
              isActive: true,
            },
            include: {
              apiKeys: {
                where: { revoked: false },
              },
            },
          },
        },
      });

      if (!user || !user.exchangeAccounts?.length) {
        this.logger.warn(`No active exchange account found for ${exchange}`);
        return;
      }

      const exchangeAccount = user.exchangeAccounts[0];
      const credentials = exchangeAccount.apiKeys?.[0] && {
        apiKey: exchangeAccount.apiKeys[0].keyHash,
        apiSecret: exchangeAccount.apiKeys[0].secretEncrypted,
      };

      const account = {
        id: exchangeAccount.id,
        userId,
        exchange,
        accountId: exchangeAccount.accountId,
        credentials,
        isActive: exchangeAccount.isActive,
        isPaper: process.env.BINANCE_USE_TESTNET !== 'false',
      };

      // Connect to exchange
      const { createExchange } = await import('@rfsanz/exchange/src/factory');
      exchangeAdapter = createExchange(exchange as any, account);
      await exchangeAdapter.connect(account);

      // Get all open orders from exchange
      const exchangeOpenOrders = await exchangeAdapter.fetchOpenOrders();

      // Get all open orders from database
      const dbOpenOrders = await prisma.order.findMany({
        where: {
          userId,
          exchange,
          status: { in: ['PENDING', 'PARTIALLY_FILLED', 'NEW'] },
        },
      });

      // Build maps for comparison
      const exchangeOrdersMap = new Map(
        exchangeOpenOrders.map((o) => [o.externalId || o.id, o]),
      );
      const dbOrdersMap = new Map(dbOpenOrders.map((o) => [o.externalId, o]));

      // Update database orders to match exchange state
      for (const dbOrder of dbOpenOrders) {
        const exchangeOrder = dbOrder.externalId 
          ? exchangeOrdersMap.get(dbOrder.externalId)
          : null;

        if (exchangeOrder) {
          // Order exists on exchange, sync status
          await this.updateOrderFromExchange(dbOrder, exchangeOrder);
        } else {
          // Order not found on exchange, mark as canceled
          if (!['FILLED', 'CANCELED', 'REJECTED'].includes(dbOrder.status)) {
            this.logger.warn(
              `Order ${dbOrder.id} not found on exchange, marking as canceled`,
            );
            await prisma.order.update({
              where: { id: dbOrder.id },
              data: {
                status: 'CANCELED',
                meta: {
                  ...dbOrder.meta,
                  reconciliationNote:
                    'Order not found on exchange during reconciliation',
                  reconciledAt: new Date().toISOString(),
                },
              },
            });
          }
        }
      }

      this.logger.log(
        `Reconciliation complete for ${exchange} user ${userId}: ${dbOpenOrders.length} orders checked`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to reconcile orders: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : '',
      );
    } finally {
      if (exchangeAdapter) {
        try {
          await exchangeAdapter.disconnect();
        } catch (error) {
          this.logger.warn(
            `Error disconnecting from exchange: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  /**
   * Cancel order on exchange
   * PHASE 1: Cancellation handling
   */
  async cancelOrder(orderId: string): Promise<{ success: boolean; message: string }> {
    let exchangeAdapter: any = null;

    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: {
            include: {
              exchangeAccounts: {
                where: {
                  exchange: order?.exchange,
                  isActive: true,
                },
                include: {
                  apiKeys: {
                    where: { revoked: false },
                  },
                },
              },
            },
          },
        },
      });

      if (!order) {
        throw new OrderNotFoundException(orderId);
      }

      // Only cancel orders that are not already in final state
      if (['FILLED', 'CANCELED', 'REJECTED'].includes(order.status)) {
        throw new OrderValidationFailedException(
          `Cannot cancel order in ${order.status} status`,
        );
      }

      if (!order.externalId) {
        throw new OrderValidationFailedException(
          `Order has no external ID, cannot cancel on exchange`,
        );
      }

      this.logger.log(`Canceling order ${orderId} (external: ${order.externalId})`);

      // Get exchange adapter
      const { createExchange } = await import('@rfsanz/exchange/src/factory');
      const exchangeAccount = order.user?.exchangeAccounts?.[0];

      if (!exchangeAccount) {
        throw new OrderValidationFailedException(
          `No active exchange account found for ${order.exchange}`,
        );
      }

      const credentials = exchangeAccount.apiKeys?.[0] && {
        apiKey: exchangeAccount.apiKeys[0].keyHash,
        apiSecret: exchangeAccount.apiKeys[0].secretEncrypted,
      };

      const account = {
        id: exchangeAccount.id,
        userId: order.user!.id,
        exchange: order.exchange,
        accountId: exchangeAccount.accountId,
        credentials,
        isActive: exchangeAccount.isActive,
        isPaper: process.env.BINANCE_USE_TESTNET !== 'false',
      };

      exchangeAdapter = createExchange(order.exchange as any, account);
      await exchangeAdapter.connect(account);

      // Cancel order on exchange
      await exchangeAdapter.cancelOrder(order.externalId);

      // Update order status
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'CANCELED',
          meta: {
            ...order.meta,
            canceledAt: new Date().toISOString(),
            cancelReason: 'User initiated cancellation',
          },
        },
      });

      this.logger.log(`Order ${orderId} successfully canceled on ${order.exchange}`);

      return {
        success: true,
        message: `Order ${orderId} has been canceled`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to cancel order: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : '',
      );

      // Publish cancellation failure event
      const order = await prisma.order
        .findUnique({ where: { id: orderId } })
        .catch(() => null);
      if (order) {
        const failEvent = new OrderFailedEvent(
          orderId,
          order.userId,
          order.symbol,
          `Cancellation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        await this.eventEmitter
          .emitAsync('trading.order.failed', failEvent)
          .catch(() => {});
      }

      throw error;
    } finally {
      if (exchangeAdapter) {
        try {
          await exchangeAdapter.disconnect();
        } catch (error) {
          this.logger.warn(
            `Error disconnecting from exchange: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  /**
   * Get recommendation's alert
   */
  private async getRecommendationAlert(recommendationId: string): Promise<any> {
    const recommendation = await prisma.recommendation.findUnique({
      where: { id: recommendationId },
    });

    if (!recommendation) {
      throw new OrderCreationFailedException(`Recommendation ${recommendationId} not found`);
    }

    return { id: recommendation.alertId };
  }

  /**
   * PHASE 2: Sync balances from exchange and store in history
   */
  async syncUserBalances(userId: string, exchange: string): Promise<any> {
    let exchangeAdapter: any = null;

    try {
      this.logger.log(`Syncing balances for user ${userId} on ${exchange}`);

      // Get exchange account and credentials
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          exchangeAccounts: {
            where: { exchange, isActive: true },
            include: { apiKeys: { where: { revoked: false } } },
          },
        },
      });

      if (!user?.exchangeAccounts?.[0]) {
        throw new OrderValidationFailedException(
          `No active exchange account found for ${exchange}`,
        );
      }

      const exchangeAccount = user.exchangeAccounts[0];
      const credentials = exchangeAccount.apiKeys?.[0] && {
        apiKey: exchangeAccount.apiKeys[0].keyHash,
        apiSecret: exchangeAccount.apiKeys[0].secretEncrypted,
      };

      const account = {
        id: exchangeAccount.id,
        userId,
        exchange,
        accountId: exchangeAccount.accountId,
        credentials,
        isActive: exchangeAccount.isActive,
        isPaper: process.env.BINANCE_USE_TESTNET !== 'false',
      };

      // Connect to exchange
      const { createExchange } = await import('@rfsanz/exchange/src/factory');
      exchangeAdapter = createExchange(exchange as any, account);
      await exchangeAdapter.connect(account);

      // Sync balances
      const result = await this.balanceSyncService.syncBalances(
        userId,
        exchangeAdapter,
        exchange,
      );

      this.logger.log(`Synced ${result.assets} assets for ${exchange}`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to sync balances: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      if (exchangeAdapter) {
        try {
          await exchangeAdapter.disconnect();
        } catch (error) {
          this.logger.warn(`Error disconnecting from exchange: ${error}`);
        }
      }
    }
  }

  /**
   * PHASE 2: Get position metrics (P&L, quantity, etc.)
   */
  async getPositionMetrics(positionId: string): Promise<any> {
    try {
      const position = await prisma.position.findUnique({
        where: { id: positionId },
      });

      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      // For live P&L, would need current market price
      // For now, return stored metrics
      return {
        positionId,
        symbol: position.symbol,
        side: position.side,
        quantity: position.quantity.toNumber(),
        entryPrice: position.entryPrice.toNumber(),
        unrealizedPnL: position.unrealizedPnL?.toNumber() || 0,
        realizedPnL: position.realizedPnL?.toNumber() || 0,
        status: position.status,
        stopLoss: position.stopLoss?.toNumber(),
        takeProfit: position.takeProfit?.toNumber(),
        openedAt: position.openedAt,
        closedAt: position.closedAt,
      };
    } catch (error) {
      this.logger.error(`Failed to get position metrics: ${error}`);
      throw error;
    }
  }

  /**
   * PHASE 2: Get total P&L metrics for user
   */
  async getPnLMetrics(userId: string): Promise<any> {
    try {
      const metrics = await this.pnlCalculationService.calculatePnLMetrics(userId);
      return metrics;
    } catch (error) {
      this.logger.error(`Failed to get P&L metrics: ${error}`);
      throw error;
    }
  }

  /**
   * PHASE 2: Update stop-loss and take-profit for a position
   */
  async updateStopLossTakeProfit(
    positionId: string,
    stopLoss?: number,
    takeProfit?: number,
  ): Promise<void> {
    try {
      const position = await prisma.position.findUnique({
        where: { id: positionId },
      });

      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      if (position.status !== 'OPEN') {
        throw new Error(`Cannot update stop-loss/take-profit for closed position`);
      }

      this.logger.log(
        `Updating position ${positionId}: SL=${stopLoss}, TP=${takeProfit}`,
      );

      await prisma.position.update({
        where: { id: positionId },
        data: {
          stopLoss: stopLoss ? new (require('decimal.js'))(stopLoss) : undefined,
          takeProfit: takeProfit ? new (require('decimal.js'))(takeProfit) : undefined,
          meta: {
            ...position.meta,
            lastUpdatedAt: new Date().toISOString(),
          },
        },
      });

      this.logger.log(`Position ${positionId} stop-loss/take-profit updated`);
    } catch (error) {
      this.logger.error(
        `Failed to update stop-loss/take-profit: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * PHASE 2: Get all open positions for user
   */
  async getOpenPositions(userId: string): Promise<any[]> {
    try {
      return await this.positionService.getOpenPositions(userId);
    } catch (error) {
      this.logger.error(`Failed to get open positions: ${error}`);
      throw error;
    }
  }

  /**
   * PHASE 2: Get all closed positions for user
   */
  async getClosedPositions(userId: string): Promise<any[]> {
    try {
      return await this.positionService.getClosedPositions(userId);
    } catch (error) {
      this.logger.error(`Failed to get closed positions: ${error}`);
      throw error;
    }
  }

  /**
   * PHASE 2: Update trading statistics
   */
  async updateTradingStats(userId: string): Promise<void> {
    try {
      await this.pnlCalculationService.updateTradingStatistics(userId);
      this.logger.log(`Trading statistics updated for user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to update trading stats: ${error}`);
      throw error;
    }
  }
}

