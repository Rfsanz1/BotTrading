export type RiskTolerance = 'conservative' | 'moderate' | 'aggressive';

export type ExecutionMode = 'manual' | 'automatic';

export type TrendBias = 'bullish' | 'bearish' | 'neutral';

export interface MarketData {
  symbol: string;
  price: number;
  volatility: number; // 0-1 range
  trendStrength: number; // -1 to 1
  liquidityScore: number; // 0-1
  supportLevels: number[];
  resistanceLevels: number[];
  newsSentimentScore?: number; // -1 to 1
  macroRisk?: number; // 0-1
}

export interface PlannerOptions {
  riskTolerance?: RiskTolerance;
  maxCapitalAllocation?: number; // absolute capital to deploy
  maxRiskPerTrade?: number; // 0-1 of capital
  preferredTimeframe?: '1m' | '5m' | '15m' | '1h' | '4h' | '1d';
  strategyBias?: 'trend' | 'mean_reversion' | 'momentum' | 'breakout' | 'neutral';
  executionMode?: ExecutionMode;
  manualApproval?: boolean;
}

export interface StrategySelection {
  name: string;
  explanation: string;
  category: string;
}

export interface TimeframeSelection {
  timeframe: string;
  rationale: string;
}

export interface RiskSelection {
  profile: RiskTolerance;
  maxRiskPercent: number;
  rationale: string;
}

export interface PositionSizing {
  sizePercent: number;
  quantity: number;
  capitalAllocated: number;
  rationale: string;
}

export interface PriceTargets {
  entry: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio: number;
}

export interface TradeProbability {
  probability: number; // 0-1
  expectedReturn: number; // percent
  expectedLoss: number; // percent
}

export interface ExecutionPlan {
  orderType: 'market' | 'limit' | 'stop';
  executionMode: ExecutionMode;
  approvalRequired: boolean;
  brokerInstruction: string;
  scheduledAt?: number;
}

export interface TradingPlan {
  planId: string;
  createdAt: number;
  symbol: string;
  marketCondition: string;
  trendBias: TrendBias;
  strategy: StrategySelection;
  timeframe: TimeframeSelection;
  risk: RiskSelection;
  sizing: PositionSizing;
  priceTargets: PriceTargets;
  probability: TradeProbability;
  execution: ExecutionPlan;
  manualApproval: boolean;
  autoExecution: boolean;
  status: 'pending' | 'approved' | 'rejected' | 'executed';
  commentary: string;
}

export interface TradingPlannerInput {
  marketData: MarketData;
  capital: number;
  options?: PlannerOptions;
}

export interface ExecutionResult {
  planId: string;
  executedAt: number;
  orderId: string;
  filledQuantity: number;
  averageFillPrice: number;
  slippagePercent: number;
  status: 'filled' | 'partial' | 'rejected' | 'cancelled';
  details: string;
}

export interface OrderExecutor {
  executeOrder(plan: TradingPlan): Promise<ExecutionResult>;
}
