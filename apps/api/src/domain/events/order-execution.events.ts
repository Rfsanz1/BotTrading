import { BaseDomainEvent } from './base-domain-event';

/**
 * Triggered when order is being validated before execution
 */
export class OrderValidationStartedEvent extends BaseDomainEvent {
  constructor(
    readonly orderId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly quantity: number,
    readonly entryPrice: number,
  ) {
    super(orderId, 'Order');
  }

  getEventName(): string {
    return 'trading.order.validation_started';
  }

  getEventPayload() {
    return {
      orderId: this.orderId,
      userId: this.userId,
      symbol: this.symbol,
      quantity: this.quantity,
      entryPrice: this.entryPrice,
      startedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when position size is calculated
 */
export class PositionSizeCalculatedEvent extends BaseDomainEvent {
  constructor(
    readonly orderId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly calculatedQuantity: number,
    readonly riskAmount: number,
    readonly percentageOfPortfolio: number,
  ) {
    super(orderId, 'Order');
  }

  getEventName(): string {
    return 'trading.position_size.calculated';
  }

  getEventPayload() {
    return {
      orderId: this.orderId,
      userId: this.userId,
      symbol: this.symbol,
      calculatedQuantity: this.calculatedQuantity,
      riskAmount: this.riskAmount,
      percentageOfPortfolio: this.percentageOfPortfolio,
      calculatedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when order is submitted to exchange
 */
export class OrderSubmittedToExchangeEvent extends BaseDomainEvent {
  constructor(
    readonly orderId: string,
    readonly userId: string,
    readonly exchange: string,
    readonly externalOrderId: string,
    readonly symbol: string,
    readonly side: 'BUY' | 'SELL',
    readonly quantity: number,
    readonly price: number,
  ) {
    super(orderId, 'Order');
  }

  getEventName(): string {
    return 'trading.order.submitted_to_exchange';
  }

  getEventPayload() {
    return {
      orderId: this.orderId,
      userId: this.userId,
      exchange: this.exchange,
      externalOrderId: this.externalOrderId,
      symbol: this.symbol,
      side: this.side,
      quantity: this.quantity,
      price: this.price,
      submittedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when exchange confirms order
 */
export class OrderConfirmedEvent extends BaseDomainEvent {
  constructor(
    readonly orderId: string,
    readonly userId: string,
    readonly externalOrderId: string,
    readonly exchange: string,
    readonly symbol: string,
  ) {
    super(orderId, 'Order');
  }

  getEventName(): string {
    return 'trading.order.confirmed';
  }

  getEventPayload() {
    return {
      orderId: this.orderId,
      userId: this.userId,
      externalOrderId: this.externalOrderId,
      exchange: this.exchange,
      symbol: this.symbol,
      confirmedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when order is filled
 */
export class OrderFilledEvent extends BaseDomainEvent {
  constructor(
    readonly orderId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly filledQuantity: number,
    readonly filledPrice: number,
    readonly fee: number,
  ) {
    super(orderId, 'Order');
  }

  getEventName(): string {
    return 'trading.order.filled';
  }

  getEventPayload() {
    return {
      orderId: this.orderId,
      userId: this.userId,
      symbol: this.symbol,
      filledQuantity: this.filledQuantity,
      filledPrice: this.filledPrice,
      fee: this.fee,
      filledAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when trade is recorded
 */
export class TradeRecordedEvent extends BaseDomainEvent {
  constructor(
    readonly tradeId: string,
    readonly orderId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly side: 'BUY' | 'SELL',
    readonly quantity: number,
    readonly price: number,
    readonly fee: number,
  ) {
    super(tradeId, 'Trade');
  }

  getEventName(): string {
    return 'trading.trade.recorded';
  }

  getEventPayload() {
    return {
      tradeId: this.tradeId,
      orderId: this.orderId,
      userId: this.userId,
      symbol: this.symbol,
      side: this.side,
      quantity: this.quantity,
      price: this.price,
      fee: this.fee,
      recordedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when position is opened or updated
 */
export class PositionUpdatedEvent extends BaseDomainEvent {
  constructor(
    readonly positionId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly side: 'BUY' | 'SELL',
    readonly quantity: number,
    readonly entryPrice: number,
    readonly unrealizedPnL?: number,
  ) {
    super(positionId, 'Position');
  }

  getEventName(): string {
    return 'trading.position.updated';
  }

  getEventPayload() {
    return {
      positionId: this.positionId,
      userId: this.userId,
      symbol: this.symbol,
      side: this.side,
      quantity: this.quantity,
      entryPrice: this.entryPrice,
      unrealizedPnL: this.unrealizedPnL,
      updatedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when portfolio is updated after trade
 */
export class PortfolioUpdatedEvent extends BaseDomainEvent {
  constructor(
    readonly portfolioId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly newQuantity: number,
    readonly newAveragePrice: number,
  ) {
    super(portfolioId, 'Portfolio');
  }

  getEventName(): string {
    return 'trading.portfolio.updated';
  }

  getEventPayload() {
    return {
      portfolioId: this.portfolioId,
      userId: this.userId,
      symbol: this.symbol,
      newQuantity: this.newQuantity,
      newAveragePrice: this.newAveragePrice,
      updatedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when trade is completed
 */
export class TradeCompletedEvent extends BaseDomainEvent {
  constructor(
    readonly tradeId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly entryPrice: number,
    readonly exitPrice?: number,
    readonly profitLoss?: number,
  ) {
    super(tradeId, 'Trade');
  }

  getEventName(): string {
    return 'trading.trade.completed';
  }

  getEventPayload() {
    return {
      tradeId: this.tradeId,
      userId: this.userId,
      symbol: this.symbol,
      entryPrice: this.entryPrice,
      exitPrice: this.exitPrice,
      profitLoss: this.profitLoss,
      completedAt: this.occurredAt,
    };
  }
}
