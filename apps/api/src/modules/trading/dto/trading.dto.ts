/**
 * Trading DTOs - Phase 1 & 2
 * Request/Response data transfer objects untuk semua endpoints
 */

import { IsString, IsNumber, IsEnum, IsOptional, IsDecimal, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';

// ─── Phase 1: Order Management ──────────────────────────────────────────────

export enum OrderSide {
  BUY = 'BUY',
  SELL = 'SELL',
}

export enum OrderType {
  LIMIT = 'LIMIT',
  MARKET = 'MARKET',
  STOP_LOSS = 'STOP_LOSS',
  TAKE_PROFIT = 'TAKE_PROFIT',
}

export class CreateOrderDTO {
  @ApiProperty({ example: 'rec-123' })
  @IsString()
  recommendationId: string;

  @ApiProperty({ example: 'BTCUSDT' })
  @IsString()
  symbol: string;

  @ApiProperty({ enum: OrderSide })
  @IsEnum(OrderSide)
  side: OrderSide;

  @ApiProperty({ example: 0.5 })
  @IsNumber()
  @Min(0)
  quantity: number;

  @ApiProperty({ example: 45000 })
  @IsNumber()
  @Min(0)
  price: number;

  @ApiProperty({ example: 'binance' })
  @IsString()
  exchange: string;

  @ApiProperty({ example: 42000, required: false })
  @IsOptional()
  @IsNumber()
  stopLoss?: number;

  @ApiProperty({ example: 48000, required: false })
  @IsOptional()
  @IsNumber()
  targetPrice?: number;
}

export class SubmitOrderDTO {
  @ApiProperty({ example: 'ord-123' })
  @IsString()
  orderId: string;
}

export class CancelOrderDTO {
  @ApiProperty({ example: 'ord-123' })
  @IsString()
  orderId: string;
}

export class RecordTradeDTO {
  @ApiProperty({ example: 'ord-123' })
  @IsString()
  orderId: string;

  @ApiProperty({ example: 0.5 })
  @IsNumber()
  filledQuantity: number;

  @ApiProperty({ example: 45100 })
  @IsNumber()
  filledPrice: number;

  @ApiProperty({ example: 22.55 })
  @IsNumber()
  @Min(0)
  fee: number;
}

export class CalculatePositionSizeDTO {
  @ApiProperty({ example: 10000 })
  @IsNumber()
  @Min(0)
  accountBalance: number;

  @ApiProperty({ example: 2, description: 'Risk percentage' })
  @IsNumber()
  @Min(0.1)
  @Max(10)
  riskPercent: number;

  @ApiProperty({ example: 45000 })
  @IsNumber()
  entryPrice: number;

  @ApiProperty({ example: 42000 })
  @IsNumber()
  stopLossPrice: number;
}

export class SyncOrdersDTO {
  @ApiProperty({ example: 'binance' })
  @IsString()
  exchange: string;
}

// ─── Phase 2: Position Management ──────────────────────────────────────────

export class OpenPositionDTO {
  @ApiProperty({ example: 'BTCUSDT' })
  @IsString()
  symbol: string;

  @ApiProperty({ enum: OrderSide })
  @IsEnum(OrderSide)
  side: OrderSide;

  @ApiProperty({ example: 45000 })
  @IsNumber()
  entryPrice: number;

  @ApiProperty({ example: 0.5 })
  @IsNumber()
  quantity: number;

  @ApiProperty({ example: 42000, required: false })
  @IsOptional()
  @IsNumber()
  stopLoss?: number;

  @ApiProperty({ example: 48000, required: false })
  @IsOptional()
  @IsNumber()
  takeProfit?: number;
}

export class UpdateStopLossTakeProfitDTO {
  @ApiProperty({ example: 42000, required: false })
  @IsOptional()
  @IsNumber()
  stopLoss?: number;

  @ApiProperty({ example: 48000, required: false })
  @IsOptional()
  @IsNumber()
  takeProfit?: number;
}

export class ClosePositionDTO {
  @ApiProperty({ example: 45500 })
  @IsNumber()
  closingPrice: number;

  @ApiProperty({ example: 'MANUAL', required: false })
  @IsOptional()
  @IsString()
  reason?: string;
}

// ─── Phase 2: Balance Sync ──────────────────────────────────────────────────

export class SyncBalancesDTO {
  @ApiProperty({ example: 'binance' })
  @IsString()
  exchange: string;
}

export class GetBalanceHistoryDTO {
  @ApiProperty({ example: 'USDT' })
  @IsString()
  asset: string;

  @ApiProperty({ example: 'binance' })
  @IsString()
  exchange: string;

  @ApiProperty({ example: 100, required: false })
  @IsOptional()
  @IsNumber()
  limit?: number;
}

// ─── Response DTOs ──────────────────────────────────────────────────────────

export class OrderResponseDTO {
  @ApiProperty()
  id: string;

  @ApiProperty()
  symbol: string;

  @ApiProperty({ enum: OrderSide })
  side: OrderSide;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  price: number;

  @ApiProperty()
  filled: number;

  @ApiProperty()
  status: string;

  @ApiProperty()
  externalId?: string;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;
}

export class PositionResponseDTO {
  @ApiProperty()
  id: string;

  @ApiProperty()
  symbol: string;

  @ApiProperty({ enum: OrderSide })
  side: OrderSide;

  @ApiProperty()
  entryPrice: number;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  unrealizedPnL: number;

  @ApiProperty()
  realizedPnL: number;

  @ApiProperty()
  status: string;

  @ApiProperty()
  stopLoss?: number;

  @ApiProperty()
  takeProfit?: number;

  @ApiProperty()
  openedAt: Date;

  @ApiProperty()
  closedAt?: Date;
}

export class BalanceResponseDTO {
  @ApiProperty()
  asset: string;

  @ApiProperty()
  free: string;

  @ApiProperty()
  locked: string;

  @ApiProperty()
  total: string;

  @ApiProperty()
  timestamp: Date;
}

export class PnLMetricsResponseDTO {
  @ApiProperty()
  realizedPnL: number;

  @ApiProperty()
  unrealizedPnL: number;

  @ApiProperty()
  totalPnL: number;

  @ApiProperty()
  totalReturn: number;

  @ApiProperty()
  totalReturnPercent: number;

  @ApiProperty()
  winRate: number;

  @ApiProperty()
  profitFactor: number;

  @ApiProperty()
  maxDrawdown: number;

  @ApiProperty()
  sharpeRatio: number;

  @ApiProperty()
  averageWin: number;

  @ApiProperty()
  averageLoss: number;

  @ApiProperty()
  winLossRatio: number;
}

export class PositionMetricsResponseDTO {
  @ApiProperty()
  positionId: string;

  @ApiProperty()
  symbol: string;

  @ApiProperty({ enum: OrderSide })
  side: OrderSide;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  entryPrice: number;

  @ApiProperty()
  unrealizedPnL: number;

  @ApiProperty()
  realizedPnL: number;

  @ApiProperty()
  status: string;

  @ApiProperty()
  stopLoss?: number;

  @ApiProperty()
  takeProfit?: number;

  @ApiProperty()
  openedAt: Date;

  @ApiProperty()
  closedAt?: Date;
}

export class ErrorResponseDTO {
  @ApiProperty()
  statusCode: number;

  @ApiProperty()
  message: string;

  @ApiProperty()
  timestamp: Date;

  @ApiProperty({ required: false })
  path?: string;
}

export class SuccessResponseDTO<T> {
  @ApiProperty()
  success: boolean;

  @ApiProperty()
  data: T;

  @ApiProperty({ required: false })
  message?: string;
}
