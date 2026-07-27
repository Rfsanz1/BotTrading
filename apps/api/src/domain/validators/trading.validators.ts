import { IsString, IsNumber, IsOptional, IsUrl, IsEnum, Min, Max, IsDecimal } from 'class-validator';

/**
 * DTO for validating TradingView webhook
 */
export class WebhookValidationDto {
  @IsString()
  symbol: string;

  @IsNumber()
  @IsOptional()
  price?: number;

  @IsOptional()
  message?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

/**
 * DTO for AI analysis request
 */
export class AIAnalysisRequestDto {
  @IsString()
  symbol: string;

  @IsNumber()
  currentPrice: number;

  @IsString()
  @IsOptional()
  timeframe?: string;

  @IsOptional()
  technicalData?: Record<string, any>;

  @IsOptional()
  fundamentalData?: Record<string, any>;
}

/**
 * DTO for recommendation creation
 */
export class RecommendationDto {
  @IsString()
  symbol: string;

  @IsEnum(['BUY', 'SELL', 'HOLD'])
  recommendationType: 'BUY' | 'SELL' | 'HOLD';

  @IsNumber()
  @IsOptional()
  entryPrice?: number;

  @IsNumber()
  @IsOptional()
  targetPrice?: number;

  @IsNumber()
  @IsOptional()
  stopLoss?: number;

  @IsNumber()
  @Min(0)
  @Max(100)
  @IsOptional()
  positionSizePercentage?: number;

  @IsString()
  @IsOptional()
  urgency?: 'LOW' | 'MEDIUM' | 'HIGH';
}

/**
 * DTO for order creation
 */
export class CreateOrderDto {
  @IsString()
  symbol: string;

  @IsEnum(['BUY', 'SELL'])
  side: 'BUY' | 'SELL';

  @IsNumber()
  quantity: number;

  @IsNumber()
  price: number;

  @IsString()
  exchange: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

/**
 * DTO for order execution
 */
export class ExecuteOrderDto {
  @IsString()
  orderId: string;

  @IsNumber()
  @IsOptional()
  slippagePercentage?: number;

  @IsString()
  @IsOptional()
  executionStrategy?: string;
}

/**
 * DTO for position size calculation
 */
export class CalculatePositionSizeDto {
  @IsNumber()
  entryPrice: number;

  @IsNumber()
  stopLoss: number;

  @IsNumber()
  accountBalance: number;

  @IsNumber()
  @Min(0.1)
  @Max(10)
  riskPercentage: number;
}

/**
 * DTO for risk assessment
 */
export class RiskAssessmentDto {
  @IsString()
  symbol: string;

  @IsNumber()
  quantity: number;

  @IsNumber()
  entryPrice: number;

  @IsNumber()
  stopLoss: number;

  @IsNumber()
  @IsOptional()
  targetPrice?: number;

  @IsNumber()
  @IsOptional()
  portfolioValue?: number;
}

/**
 * DTO for user action on recommendation
 */
export class RecommendationActionDto {
  @IsEnum(['APPROVE', 'REJECT', 'ANALYZE_AGAIN'])
  action: 'APPROVE' | 'REJECT' | 'ANALYZE_AGAIN';

  @IsString()
  @IsOptional()
  reason?: string;

  @IsOptional()
  metadata?: Record<string, any>;
}

/**
 * DTO for market data query
 */
export class MarketDataQueryDto {
  @IsString()
  symbol: string;

  @IsString()
  @IsOptional()
  timeframe?: string;

  @IsOptional()
  filters?: Record<string, any>;
}
