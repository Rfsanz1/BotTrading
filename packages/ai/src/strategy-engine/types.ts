export type StrategyAction = 'BUY' | 'SELL' | 'HOLD' | 'CLOSE';

export type IndicatorName =
  | 'EMA'
  | 'SMA'
  | 'VWAP'
  | 'MACD'
  | 'RSI'
  | 'Bollinger Bands'
  | 'ATR'
  | 'ADX'
  | 'Ichimoku'
  | 'SuperTrend'
  | 'Smart Money Concept'
  | 'ICT'
  | 'Wyckoff'
  | 'Price Action'
  | 'Volume Profile'
  | 'Order Blocks'
  | 'Fair Value Gap'
  | 'Liquidity Sweep'
  | 'Breaker Block'
  | 'Mitigation Block';

export interface StrategyRule {
  condition: string;
  action: StrategyAction;
  weight: number;
}

export interface StrategyParameter {
  name: string;
  value: number | string | boolean;
  type: 'number' | 'string' | 'boolean';
  min?: number;
  max?: number;
  description: string;
}

export interface RiskManagementRule {
  type: 'max_position' | 'max_loss' | 'take_profit' | 'stop_loss' | 'correlation_check';
  threshold: number;
  action: string;
}

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  indicators: IndicatorName[];
  rules: StrategyRule[];
  parameters: StrategyParameter[];
  riskManagement: RiskManagementRule[];
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MarketBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  indicators?: Record<string, any>;
}

export interface StrategyInput {
  symbol: string;
  price: number;
  previousClose?: number;
  ema?: { short?: number; long?: number };
  sma?: { short?: number; long?: number };
  vwap?: number;
  macd?: { line?: number; signal?: number; histogram?: number };
  rsi?: number;
  bollinger?: { upper?: number; middle?: number; lower?: number; width?: number; squeeze?: boolean };
  atr?: number;
  adx?: number;
  ichimoku?: { conversion?: number; base?: number; leadingA?: number; leadingB?: number; cloud?: boolean };
  superTrend?: { direction?: 'up' | 'down' | 'neutral'; value?: number };
  smc?: { structure?: string; orderBlock?: boolean; fairValueGap?: boolean; liquiditySweep?: boolean; breakerBlock?: boolean; mitigationBlock?: boolean };
  ict?: { orderBlock?: boolean; fairValueGap?: boolean; liquiditySweep?: boolean; breakerBlock?: boolean; mitigationBlock?: boolean };
  wyckoff?: { phase?: string; accumulation?: boolean; distribution?: boolean };
  priceAction?: { trend?: 'up' | 'down' | 'neutral'; breakout?: boolean; retest?: boolean; pattern?: string };
  volumeProfile?: { valueAreaHigh?: number; valueAreaLow?: number; poc?: number; bias?: 'buy' | 'sell' | 'neutral' };
  orderBlocks?: Array<{ side: 'bullish' | 'bearish'; active: boolean }>;
  fairValueGap?: { bullish?: boolean; bearish?: boolean; strength?: number };
  liquiditySweep?: boolean;
  breakerBlock?: { bullish?: boolean; bearish?: boolean };
  mitigationBlock?: { bullish?: boolean; bearish?: boolean };
  volume?: number;
  volumeAverage?: number;
  volatility?: number;
  marketBias?: string;
  custom?: Record<string, any>;
}

export interface StrategyEvaluation {
  action: StrategyAction;
  score: number;
  buyScore: number;
  sellScore: number;
  holdScore: number;
  confidence: number;
  reasons: string[];
  strategyId: string;
  templateId: string;
}

export interface StrategySignal {
  strategyId: string;
  action: StrategyAction;
  score: number;
  reasons: string[];
  confidence: number;
}

export interface CombinedStrategySignal {
  action: StrategyAction;
  score: number;
  buyScore: number;
  sellScore: number;
  holdScore: number;
  confidence: number;
  signals: StrategySignal[];
  reasons: string[];
}

export interface BacktestTrade {
  entryTimestamp: number;
  exitTimestamp: number;
  action: StrategyAction;
  entryPrice: number;
  exitPrice: number;
  pnlPercent: number;
}

export interface BacktestReport {
  strategyId: string;
  totalTrades: number;
  winRate: number;
  avgTradeReturn: number;
  totalReturn: number;
  maxDrawdown: number;
  profitFactor: number;
  sharpeRatio: number;
  trades: BacktestTrade[];
}

export interface OptimizationResult {
  strategyId: string;
  parameters: Record<string, number | string | boolean>;
  report: BacktestReport;
}
