import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationSentEvent } from '../../domain/exceptions';
import { NotificationSendFailedException } from '../../domain/exceptions';
import prisma from '@rfsanz/database/src/client';
import { ITelegramNotifier } from '../../domain/interfaces';

@Injectable()
export class NotificationService implements ITelegramNotifier {
  private readonly logger = new Logger(NotificationService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Send alert via Telegram
   */
  async sendAlert(userId: string, message: string, metadata?: Record<string, any>): Promise<boolean> {
    try {
      this.logger.log(`Sending Telegram alert to user ${userId}`);

      // TODO: Implement actual Telegram API call
      // For now, we'll just log and save to database

      // Get user's Telegram subscription
      const subscription = await prisma.subscription.findFirst({
        where: {
          userId,
          channel: 'TELEGRAM',
          enabled: true,
        },
      });

      if (!subscription) {
        this.logger.warn(`User ${userId} has no active Telegram subscription`);
        return false;
      }

      // Create notification record
      const notification = await prisma.notification.create({
        data: {
          userId,
          type: 'ALERT',
          title: 'Trading Alert',
          body: message,
          data: metadata,
        },
      });

      // Publish event
      const event = new NotificationSentEvent(
        notification.id,
        userId,
        'TELEGRAM',
        'Trading Alert',
        message,
        metadata,
      );
      await this.eventEmitter.emitAsync('trading.notification.sent', event);

      this.logger.log(`Alert sent successfully to user ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send alert: ${error.message}`, error.stack);
      throw new NotificationSendFailedException('TELEGRAM', error.message);
    }
  }

  /**
   * Send notification via Telegram
   */
  async sendNotification(userId: string, title: string, body: string, data?: Record<string, any>): Promise<boolean> {
    try {
      this.logger.log(`Sending Telegram notification to user ${userId}`);

      // TODO: Implement actual Telegram API call

      // Create notification record
      const notification = await prisma.notification.create({
        data: {
          userId,
          type: 'NOTIFICATION',
          title,
          body,
          data,
        },
      });

      // Publish event
      const event = new NotificationSentEvent(
        notification.id,
        userId,
        'TELEGRAM',
        title,
        body,
        data,
      );
      await this.eventEmitter.emitAsync('trading.notification.sent', event);

      this.logger.log(`Notification sent successfully to user ${userId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to send notification: ${error.message}`, error.stack);
      throw new NotificationSendFailedException('TELEGRAM', error.message);
    }
  }

  /**
   * Send recommendation alert
   */
  async sendRecommendationAlert(userId: string, recommendation: any): Promise<void> {
    try {
      const message = `🚀 NEW TRADING RECOMMENDATION\n\n` +
        `Symbol: ${recommendation.symbol}\n` +
        `Action: ${recommendation.recommendationType}\n` +
        `Confidence: ${Math.round(Number(recommendation.confidenceScore) * 100)}%\n` +
        `Entry: ${recommendation.entryPrice}\n` +
        `Target: ${recommendation.targetPrice}\n` +
        `Stop Loss: ${recommendation.stopLoss}\n` +
        `Urgency: ${recommendation.urgency}`;

      await this.sendAlert(userId, message, {
        type: 'RECOMMENDATION',
        recommendationId: recommendation.id,
        symbol: recommendation.symbol,
      });
    } catch (error) {
      this.logger.error(`Failed to send recommendation alert: ${error.message}`);
    }
  }

  /**
   * Send order confirmation
   */
  async sendOrderConfirmation(userId: string, order: any): Promise<void> {
    try {
      const message = `✅ ORDER CREATED\n\n` +
        `Symbol: ${order.symbol}\n` +
        `Side: ${order.side}\n` +
        `Quantity: ${order.quantity}\n` +
        `Price: ${order.price}\n` +
        `Exchange: ${order.exchange}`;

      await this.sendNotification(userId, 'Order Confirmation', message, {
        type: 'ORDER_CREATED',
        orderId: order.id,
        symbol: order.symbol,
      });
    } catch (error) {
      this.logger.error(`Failed to send order confirmation: ${error.message}`);
    }
  }

  /**
   * Send trade notification
   */
  async sendTradeNotification(userId: string, trade: any, order: any): Promise<void> {
    try {
      const pnl = (trade.price - order.price) * trade.quantity;
      const pnlPercent = ((trade.price - order.price) / order.price) * 100;

      const message = `🎯 TRADE EXECUTED\n\n` +
        `Symbol: ${order.symbol}\n` +
        `Quantity: ${trade.quantity}\n` +
        `Price: ${trade.price}\n` +
        `Fee: ${trade.fee}\n` +
        `P&L: ${pnl.toFixed(2)} (${pnlPercent.toFixed(2)}%)`;

      await this.sendNotification(userId, 'Trade Executed', message, {
        type: 'TRADE_EXECUTED',
        tradeId: trade.id,
        orderId: order.id,
        symbol: order.symbol,
      });
    } catch (error) {
      this.logger.error(`Failed to send trade notification: ${error.message}`);
    }
  }

  /**
   * Get user's notifications
   */
  async getUserNotifications(userId: string, limit: number = 50): Promise<any[]> {
    return prisma.notification.findMany({
      where: { userId },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string): Promise<void> {
    await prisma.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
  }
}
