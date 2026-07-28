import { Side, RecommendationType } from '../enums';

export interface CreateOrderDto {
  portfolioId: string;
  symbol:      string;
  side:        Side;
  price:       number;
  quantity:    number;
}

export interface ClosePositionDto {
  positionId: string;
  price:      number;
}

export interface TradeHistoryQueryDto {
  portfolioId?: string;
  symbol?:      string;
  side?:        Side;
  from?:        Date;
  to?:          Date;
  page?:        number;
  limit?:       number;
}

export interface RecommendationQueryDto {
  symbol?:     string;
  type?:       RecommendationType;
  minConfidence?: number;
  from?:       Date;
  to?:         Date;
  page?:       number;
  limit?:      number;
}
