import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import prisma from '@rfsanz/database/src/client';
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

  constructor(private readonly eventEmitter: EventEmitter2) {}

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
   */
  async submitToExchange(orderId: string): Promise<{ success: boolean; externalOrderId?: string }> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
      });

      if (!order) {
        throw new OrderNotFoundException(orderId);
      }

      if (order.status !== 'NEW') {
        throw new OrderValidationFailedException(`Order status must be NEW, current: ${order.status}`);
      }

      this.logger.log(`Submitting order ${orderId} to exchange ${order.exchange}`);

      // Simulate exchange submission
      // TODO: Implement actual exchange API calls
      const externalOrderId = `EXT-${Date.now()}-${Math.random().toString(36).substring(7)}`;

      // Update order status
      await prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'NEW',
          externalId: externalOrderId,
          meta: {
            ...order.meta,
            externalOrderId,
            submittedAt: new Date(),
          },
        },
      });

      // Publish event
      const event = new OrderSubmittedToExchangeEvent(
        orderId,
        order.userId,
        order.exchange,
        externalOrderId,
        order.symbol,
        order.side as any,
        order.quantity,
        order.price || 0,
      );
      await this.eventEmitter.emitAsync('trading.order.submitted_to_exchange', event);

      this.logger.log(`Order submitted to exchange: ${externalOrderId}`);

      return { success: true, externalOrderId };
    } catch (error) {
      this.logger.error(`Failed to submit order to exchange: ${error.message}`, error.stack);

      // Publish failure event
      const order = await prisma.order.findUnique({ where: { id: orderId } }).catch(() => null);
      if (order) {
        const failEvent = new OrderFailedEvent(
          orderId,
          order.userId,
          order.symbol,
          error.message,
        );
        await this.eventEmitter.emitAsync('trading.order.failed', failEvent).catch(() => {});
      }

      throw error;
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
}
