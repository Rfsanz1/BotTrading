import { DataQualityResult } from '../services/data-quality.service';
import { OrderBookState } from '../services/local-order-book.engine';
import { TradeFlowState } from '../services/trade-flow.service';
import { StructureState } from '../services/market-structure.service';

export type CanonicalMarketType = 'spot' | 'futures';
export type CanonicalTimeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface CanonicalCandle {
  openTime: number;
  closeTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closed: boolean;
}

export interface TimeframeFeatureState {
  trend: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  momentum: number | null;
  volatility: number | null;
  structure: 'BULLISH' | 'BEARISH' | 'RANGE' | 'UNKNOWN';
  volume: number | null;
  updatedAt: number;
}

export interface FuturesState {
  markPrice: number | null;
  indexPrice: number | null;
  lastPrice: number | null;
  basis: number | null;
  basisPct: number | null;
  fundingRate: number | null;
  fundingHistory: number[];
  fundingMean: number | null;
  fundingStd: number | null;
  fundingZScore: number | null;
  fundingPercentile: number | null;
  openInterestContracts: number | null;
  openInterestHistory: number[];
  openInterestDelta: number | null;
  openInterestPctChange: number | null;
  openInterestZScore: number | null;
  openInterestPercentile: number | null;
  lastUpdateAt: number | null;
}

export interface LiquidationState {
  buyVolume: number;
  sellVolume: number;
  totalVolume: number;
  imbalance: number | null;
  level: 'LIQUIDATION_NORMAL' | 'LIQUIDATION_ELEVATED' | 'LIQUIDATION_SPIKE';
  zScore: number | null;
  lastLiquidationTime: number | null;
}

export interface CanonicalMarketState {
  symbol: string;
  marketType: CanonicalMarketType;
  lastPrice: number | null;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  candles: Record<CanonicalTimeframe, CanonicalCandle[]>;
  formingCandles: Partial<Record<CanonicalTimeframe, CanonicalCandle>>;
  orderBook: OrderBookState | null;
  tradeFlow: TradeFlowState;
  futures: FuturesState;
  liquidation: LiquidationState;
  structure: Partial<Record<CanonicalTimeframe, StructureState>>;
  timeframes: Partial<Record<CanonicalTimeframe, TimeframeFeatureState>>;
  dataQuality: DataQualityResult;
  lastUpdate: number | null;
  lastEventType: string | null;
}
