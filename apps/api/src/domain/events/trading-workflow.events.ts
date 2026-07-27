import { BaseDomainEvent } from './base-domain-event';

/**
 * Triggered when a TradingView webhook is received
 */
export class AlertReceivedEvent extends BaseDomainEvent {
  constructor(
    readonly alertId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly webhookPayload: Record<string, any>,
    readonly webhookSource: string,
  ) {
    super(alertId, 'Alert');
  }

  getEventName(): string {
    return 'trading.alert.received';
  }

  getEventPayload() {
    return {
      alertId: this.alertId,
      userId: this.userId,
      symbol: this.symbol,
      webhookSource: this.webhookSource,
      receivedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when alert webhook is validated
 */
export class AlertValidatedEvent extends BaseDomainEvent {
  constructor(
    readonly alertId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly isValid: boolean,
    readonly validationErrors?: string[],
  ) {
    super(alertId, 'Alert');
  }

  getEventName(): string {
    return 'trading.alert.validated';
  }

  getEventPayload() {
    return {
      alertId: this.alertId,
      userId: this.userId,
      symbol: this.symbol,
      isValid: this.isValid,
      validationErrors: this.validationErrors,
      validatedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when alert processing starts
 */
export class AlertProcessingStartedEvent extends BaseDomainEvent {
  constructor(
    readonly alertId: string,
    readonly userId: string,
    readonly symbol: string,
  ) {
    super(alertId, 'Alert');
  }

  getEventName(): string {
    return 'trading.alert.processing_started';
  }

  getEventPayload() {
    return {
      alertId: this.alertId,
      userId: this.userId,
      symbol: this.symbol,
      startedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when market data is fetched
 */
export class MarketDataFetchedEvent extends BaseDomainEvent {
  constructor(
    readonly alertId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly currentPrice: number,
    readonly marketData: Record<string, any>,
  ) {
    super(alertId, 'Alert');
  }

  getEventName(): string {
    return 'trading.market_data.fetched';
  }

  getEventPayload() {
    return {
      alertId: this.alertId,
      userId: this.userId,
      symbol: this.symbol,
      currentPrice: this.currentPrice,
      fetchedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when AI analysis is complete
 */
export class AIAnalysisCompletedEvent extends BaseDomainEvent {
  constructor(
    readonly alertId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly analysisResults: Array<{
      provider: string;
      recommendation: 'BUY' | 'SELL' | 'HOLD';
      confidence: number;
      analysis: string;
      riskLevel: string;
    }>,
  ) {
    super(alertId, 'Alert');
  }

  getEventName(): string {
    return 'trading.analysis.completed';
  }

  getEventPayload() {
    return {
      alertId: this.alertId,
      userId: this.userId,
      symbol: this.symbol,
      analysisCount: this.analysisResults.length,
      completedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when AI consensus is built
 */
export class ConsensusBuiltEvent extends BaseDomainEvent {
  constructor(
    readonly alertId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly recommendation: 'BUY' | 'SELL' | 'HOLD',
    readonly confidenceScore: number,
    readonly riskScore: number,
    readonly providerVotes: Record<string, string>,
  ) {
    super(alertId, 'Alert');
  }

  getEventName(): string {
    return 'trading.consensus.built';
  }

  getEventPayload() {
    return {
      alertId: this.alertId,
      userId: this.userId,
      symbol: this.symbol,
      recommendation: this.recommendation,
      confidenceScore: this.confidenceScore,
      riskScore: this.riskScore,
      builtAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when recommendation is generated
 */
export class RecommendationGeneratedEvent extends BaseDomainEvent {
  constructor(
    readonly alertId: string,
    readonly userId: string,
    readonly recommendationId: string,
    readonly symbol: string,
    readonly recommendation: 'BUY' | 'SELL' | 'HOLD',
    readonly entryPrice?: number,
    readonly stopLoss?: number,
    readonly targetPrice?: number,
  ) {
    super(recommendationId, 'Recommendation');
  }

  getEventName(): string {
    return 'trading.recommendation.generated';
  }

  getEventPayload() {
    return {
      alertId: this.alertId,
      userId: this.userId,
      recommendationId: this.recommendationId,
      symbol: this.symbol,
      recommendation: this.recommendation,
      entryPrice: this.entryPrice,
      stopLoss: this.stopLoss,
      targetPrice: this.targetPrice,
      generatedAt: this.occurredAt,
    };
  }
}

/**
 * Triggered when user approves a recommendation
 */
export class RecommendationApprovedEvent extends BaseDomainEvent {
  constructor(
    readonly recommendationId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly approvedAt: Date = new Date(),
  ) {
    super(recommendationId, 'Recommendation');
  }

  getEventName(): string {
    return 'trading.recommendation.approved';
  }

  getEventPayload() {
    return {
      recommendationId: this.recommendationId,
      userId: this.userId,
      symbol: this.symbol,
      approvedAt: this.approvedAt,
    };
  }
}

/**
 * Triggered when user rejects a recommendation
 */
export class RecommendationRejectedEvent extends BaseDomainEvent {
  constructor(
    readonly recommendationId: string,
    readonly userId: string,
    readonly symbol: string,
    readonly reason?: string,
  ) {
    super(recommendationId, 'Recommendation');
  }

  getEventName(): string {
    return 'trading.recommendation.rejected';
  }

  getEventPayload() {
    return {
      recommendationId: this.recommendationId,
      userId: this.userId,
      symbol: this.symbol,
      reason: this.reason,
      rejectedAt: this.occurredAt,
    };
  }
}
