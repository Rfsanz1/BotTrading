import { BaseDomainEvent } from './base-domain-event';

/**
 * Triggered when notification is sent to user
 */
export class NotificationSentEvent extends BaseDomainEvent {
  constructor(
    readonly notificationId: string,
    readonly userId: string,
    readonly channel: 'TELEGRAM' | 'EMAIL' | 'PUSH',
    readonly title: string,
    readonly message: string,
    readonly metadata?: Record<string, any>,
  ) {
    super(notificationId, 'Notification');
  }

  getEventName(): string {
    return 'trading.notification.sent';
  }

  getEventPayload() {
    return {
      notificationId: this.notificationId,
      userId: this.userId,
      channel: this.channel,
      title: this.title,
      sentAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when audit log is recorded
 */
export class AuditLogRecordedEvent extends BaseDomainEvent {
  constructor(
    readonly auditLogId: string,
    readonly userId: string,
    readonly action: string,
    readonly resource: string,
    readonly changes?: Record<string, any>,
    readonly ipAddress?: string,
  ) {
    super(auditLogId, 'AuditLog');
  }

  getEventName(): string {
    return 'trading.audit_log.recorded';
  }

  getEventPayload() {
    return {
      auditLogId: this.auditLogId,
      userId: this.userId,
      action: this.action,
      resource: this.resource,
      recordedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when trading statistics are updated
 */
export class TradingStatisticsUpdatedEvent extends BaseDomainEvent {
  constructor(
    readonly statisticsId: string,
    readonly userId: string,
    readonly totalTrades: number,
    readonly winRate: number,
    readonly totalProfit: number,
    readonly maxDrawdown: number,
  ) {
    super(statisticsId, 'TradingStatistics');
  }

  getEventName(): string {
    return 'trading.statistics.updated';
  }

  getEventPayload() {
    return {
      statisticsId: this.statisticsId,
      userId: this.userId,
      totalTrades: this.totalTrades,
      winRate: this.winRate,
      totalProfit: this.totalProfit,
      maxDrawdown: this.maxDrawdown,
      updatedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when AI performance is recorded
 */
export class AIPerformanceRecordedEvent extends BaseDomainEvent {
  constructor(
    readonly performanceId: string,
    readonly provider: string,
    readonly symbol: string,
    readonly recommendation: 'BUY' | 'SELL' | 'HOLD',
    readonly accuracy: number,
    readonly profitLoss: number,
  ) {
    super(performanceId, 'AIPerformance');
  }

  getEventName(): string {
    return 'trading.ai_performance.recorded';
  }

  getEventPayload() {
    return {
      performanceId: this.performanceId,
      provider: this.provider,
      symbol: this.symbol,
      recommendation: this.recommendation,
      accuracy: this.accuracy,
      profitLoss: this.profitLoss,
      recordedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when order fails
 */
export class OrderFailedEvent extends BaseDomainEvent {
  constructor(
    readonly orderId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly reason: string,
    readonly errorCode?: string,
  ) {
    super(orderId, 'Order');
  }

  getEventName(): string {
    return 'trading.order.failed';
  }

  getEventPayload() {
    return {
      orderId: this.orderId,
      userId: this.userId,
      symbol: this.symbol,
      reason: this.reason,
      errorCode: this.errorCode,
      failedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when alert processing fails
 */
export class AlertProcessingFailedEvent extends BaseDomainEvent {
  constructor(
    readonly alertId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly reason: string,
    readonly errorCode?: string,
  ) {
    super(alertId, 'Alert');
  }

  getEventName(): string {
    return 'trading.alert.processing_failed';
  }

  getEventPayload() {
    return {
      alertId: this.alertId,
      userId: this.userId,
      symbol: this.symbol,
      reason: this.reason,
      errorCode: this.errorCode,
      failedAt: this.occurredAt,
    };
  }
}
