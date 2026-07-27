/**
 * Interfaces for trading workflow services
 */

export interface IAIProvider {
  getName(): string;
  analyzeMarket(symbol: string, data: Record<string, any>): Promise<{
    recommendation: 'BUY' | 'SELL' | 'HOLD';
    confidence: number;
    analysis: string;
    riskLevel: string;
    sentiment?: string;
    keyPoints?: string[];
  }>;
  isAvailable(): Promise<boolean>;
}

export interface IWebhookValidator {
  validate(payload: Record<string, any>): Promise<{
    isValid: boolean;
    errors?: string[];
    parsedData?: Record<string, any>;
  }>;
}

export interface IMarketDataProvider {
  fetchCurrentPrice(symbol: string): Promise<number>;
  fetchMarketData(symbol: string, timeframe?: string): Promise<Record<string, any>>;
  fetchHistoricalData(symbol: string, limit?: number): Promise<Record<string, any>[]>;
}

export interface IRiskCalculator {
  calculateRisk(params: {
    entryPrice: number;
    stopLoss: number;
    targetPrice?: number;
    quantity: number;
    portfolioValue?: number;
  }): Promise<{
    riskAmount: number;
    riskPercentage: number;
    rewardAmount?: number;
    riskRewardRatio?: number;
    isAcceptable: boolean;
  }>;

  calculatePositionSize(params: {
    entryPrice: number;
    stopLoss: number;
    accountBalance: number;
    riskPercentage: number;
  }): Promise<{
    quantity: number;
    positionValue: number;
    riskAmount: number;
  }>;
}

export interface IOrderExecutor {
  createOrder(params: {
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    exchange: string;
  }): Promise<{
    orderId: string;
    externalOrderId?: string;
    status: string;
  }>;

  submitToExchange(orderId: string): Promise<{
    success: boolean;
    externalOrderId?: string;
    error?: string;
  }>;

  getOrderStatus(orderId: string): Promise<{
    status: string;
    filled: number;
    remaining: number;
  }>;
}

export interface ITelegramNotifier {
  sendAlert(userId: string, message: string, metadata?: Record<string, any>): Promise<boolean>;
  sendNotification(userId: string, title: string, body: string, data?: Record<string, any>): Promise<boolean>;
}

export interface IEventPublisher {
  publish(event: any): Promise<void>;
  publishBatch(events: any[]): Promise<void>;
}

export interface IEventHandler<T> {
  handle(event: T): Promise<void>;
  canHandle(event: any): boolean;
}

export interface IConsensusBuilder {
  buildConsensus(analyses: Array<{
    provider: string;
    recommendation: 'BUY' | 'SELL' | 'HOLD';
    confidence: number;
  }>): Promise<{
    recommendation: 'BUY' | 'SELL' | 'HOLD';
    confidenceScore: number;
    providerVotes: Record<string, string>;
    agreement: number;
  }>;
}

export interface IRecommendationGenerator {
  generate(params: {
    symbol: string;
    consensusRecommendation: 'BUY' | 'SELL' | 'HOLD';
    confidenceScore: number;
    riskScore: number;
    currentPrice: number;
    targetPrice?: number;
    stopLoss?: number;
  }): Promise<{
    recommendation: 'BUY' | 'SELL' | 'HOLD';
    entryPrice: number;
    targetPrice?: number;
    stopLoss?: number;
    riskReward?: number;
    reasoning: string;
  }>;
}

export interface IAuditLogger {
  log(params: {
    userId: string;
    action: string;
    resource: string;
    changes?: Record<string, any>;
    ipAddress?: string;
  }): Promise<void>;

  logError(params: {
    userId: string;
    action: string;
    error: string;
    ipAddress?: string;
  }): Promise<void>;
}
