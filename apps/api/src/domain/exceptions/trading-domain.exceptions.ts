import { BadRequestException, NotFoundException, ForbiddenException, InternalServerErrorException, ConflictException } from '@nestjs/common';

/**
 * Base custom exception for trading domain
 */
export abstract class TradingDomainException extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly httpStatusCode: number,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

/**
 * Thrown when webhook validation fails
 */
export class WebhookValidationException extends TradingDomainException {
  constructor(message: string, public readonly errors?: string[]) {
    super(message, 'WEBHOOK_VALIDATION_FAILED', 400);
  }
}

/**
 * Thrown when alert is not found
 */
export class AlertNotFoundException extends TradingDomainException {
  constructor(alertId: string) {
    super(`Alert with ID ${alertId} not found`, 'ALERT_NOT_FOUND', 404);
  }
}

/**
 * Thrown when AI provider is not available
 */
export class AIProviderNotAvailableException extends TradingDomainException {
  constructor(provider: string) {
    super(`AI provider ${provider} is not available`, 'AI_PROVIDER_NOT_AVAILABLE', 503);
  }
}

/**
 * Thrown when AI analysis fails
 */
export class AIAnalysisFailedException extends TradingDomainException {
  constructor(provider: string, message: string) {
    super(`AI analysis failed for provider ${provider}: ${message}`, 'AI_ANALYSIS_FAILED', 500);
  }
}

/**
 * Thrown when consensus cannot be built
 */
export class ConsensusFailedException extends TradingDomainException {
  constructor(reason: string) {
    super(`Failed to build consensus: ${reason}`, 'CONSENSUS_FAILED', 500);
  }
}

/**
 * Thrown when recommendation already exists
 */
export class RecommendationAlreadyExistsException extends TradingDomainException {
  constructor(alertId: string) {
    super(`Recommendation already exists for alert ${alertId}`, 'RECOMMENDATION_ALREADY_EXISTS', 409);
  }
}

/**
 * Thrown when recommendation is not found
 */
export class RecommendationNotFoundException extends TradingDomainException {
  constructor(recommendationId: string) {
    super(`Recommendation with ID ${recommendationId} not found`, 'RECOMMENDATION_NOT_FOUND', 404);
  }
}

/**
 * Thrown when user approves/rejects invalid recommendation status
 */
export class InvalidRecommendationStatusException extends TradingDomainException {
  constructor(currentStatus: string) {
    super(`Cannot process recommendation with status ${currentStatus}`, 'INVALID_RECOMMENDATION_STATUS', 400);
  }
}

/**
 * Thrown when order creation fails
 */
export class OrderCreationFailedException extends TradingDomainException {
  constructor(reason: string) {
    super(`Order creation failed: ${reason}`, 'ORDER_CREATION_FAILED', 400);
  }
}

/**
 * Thrown when order is not found
 */
export class OrderNotFoundException extends TradingDomainException {
  constructor(orderId: string) {
    super(`Order with ID ${orderId} not found`, 'ORDER_NOT_FOUND', 404);
  }
}

/**
 * Thrown when order validation fails
 */
export class OrderValidationFailedException extends TradingDomainException {
  constructor(reason: string, public readonly details?: Record<string, any>) {
    super(`Order validation failed: ${reason}`, 'ORDER_VALIDATION_FAILED', 400);
  }
}

/**
 * Thrown when order submission to exchange fails
 */
export class OrderSubmissionFailedException extends TradingDomainException {
  constructor(exchange: string, reason: string) {
    super(`Order submission to ${exchange} failed: ${reason}`, 'ORDER_SUBMISSION_FAILED', 502);
  }
}

/**
 * Thrown when position size calculation fails
 */
export class PositionSizeCalculationFailedException extends TradingDomainException {
  constructor(reason: string) {
    super(`Position size calculation failed: ${reason}`, 'POSITION_SIZE_CALCULATION_FAILED', 400);
  }
}

/**
 * Thrown when portfolio is not found
 */
export class PortfolioNotFoundException extends TradingDomainException {
  constructor(portfolioId: string) {
    super(`Portfolio with ID ${portfolioId} not found`, 'PORTFOLIO_NOT_FOUND', 404);
  }
}

/**
 * Thrown when portfolio update fails
 */
export class PortfolioUpdateFailedException extends TradingDomainException {
  constructor(reason: string) {
    super(`Portfolio update failed: ${reason}`, 'PORTFOLIO_UPDATE_FAILED', 500);
  }
}

/**
 * Thrown when market data cannot be fetched
 */
export class MarketDataFetchException extends TradingDomainException {
  constructor(symbol: string, source: string, reason: string) {
    super(`Failed to fetch market data for ${symbol} from ${source}: ${reason}`, 'MARKET_DATA_FETCH_FAILED', 503);
  }
}

/**
 * Thrown when notification fails to send
 */
export class NotificationSendFailedException extends TradingDomainException {
  constructor(channel: string, reason: string) {
    super(`Failed to send notification via ${channel}: ${reason}`, 'NOTIFICATION_SEND_FAILED', 500);
  }
}

/**
 * Thrown when audit log recording fails
 */
export class AuditLogRecordingFailedException extends TradingDomainException {
  constructor(reason: string) {
    super(`Audit log recording failed: ${reason}`, 'AUDIT_LOG_RECORDING_FAILED', 500);
  }
}

/**
 * Thrown when risk calculation fails
 */
export class RiskCalculationFailedException extends TradingDomainException {
  constructor(reason: string) {
    super(`Risk calculation failed: ${reason}`, 'RISK_CALCULATION_FAILED', 400);
  }
}

/**
 * Thrown when risk limits are exceeded
 */
export class RiskLimitExceededException extends TradingDomainException {
  constructor(reason: string, public readonly limit?: string, public readonly currentValue?: number) {
    super(`Risk limit exceeded: ${reason}`, 'RISK_LIMIT_EXCEEDED', 400);
  }
}

/**
 * Thrown when insufficient balance for trade
 */
export class InsufficientBalanceException extends TradingDomainException {
  constructor(required: number, available: number) {
    super(`Insufficient balance. Required: ${required}, Available: ${available}`, 'INSUFFICIENT_BALANCE', 400);
  }
}

/**
 * Thrown when user is not authorized to perform action
 */
export class UnauthorizedTradingActionException extends TradingDomainException {
  constructor(action: string) {
    super(`User is not authorized to perform action: ${action}`, 'UNAUTHORIZED_ACTION', 403);
  }
}

/**
 * Thrown when trade execution fails
 */
export class TradeExecutionFailedException extends TradingDomainException {
  constructor(reason: string) {
    super(`Trade execution failed: ${reason}`, 'TRADE_EXECUTION_FAILED', 500);
  }
}

/**
 * Thrown when position is not found
 */
export class PositionNotFoundException extends TradingDomainException {
  constructor(positionId: string) {
    super(`Position with ID ${positionId} not found`, 'POSITION_NOT_FOUND', 404);
  }
}

/**
 * Thrown when exchange is not supported
 */
export class ExchangeNotSupportedException extends TradingDomainException {
  constructor(exchange: string) {
    super(`Exchange ${exchange} is not supported`, 'EXCHANGE_NOT_SUPPORTED', 400);
  }
}

/**
 * Thrown when exchange connection fails
 */
export class ExchangeConnectionFailedException extends TradingDomainException {
  constructor(exchange: string, reason: string) {
    super(`Failed to connect to ${exchange}: ${reason}`, 'EXCHANGE_CONNECTION_FAILED', 503);
  }
}

/**
 * Maps domain exceptions to NestJS HTTP exceptions
 */
export function mapDomainExceptionToHttpException(error: TradingDomainException): Error {
  switch (error.httpStatusCode) {
    case 400:
      return new BadRequestException({
        message: error.message,
        code: error.code,
      });
    case 404:
      return new NotFoundException({
        message: error.message,
        code: error.code,
      });
    case 403:
      return new ForbiddenException({
        message: error.message,
        code: error.code,
      });
    case 409:
      return new ConflictException({
        message: error.message,
        code: error.code,
      });
    case 503:
      return new InternalServerErrorException({
        message: error.message,
        code: error.code,
      });
    default:
      return new InternalServerErrorException({
        message: error.message,
        code: error.code,
      });
  }
}
