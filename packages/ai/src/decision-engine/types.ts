export type DecisionAction = 'BUY' | 'SELL' | 'HOLD';

export interface MarketData {
  symbol: string;
  price: number;
  changePercent?: number;
  volume?: number;
  timestamp?: number;
}

export interface TechnicalIndicators {
  rsi?: number;
  macd?: number;
  ma20?: number;
  ma50?: number;
  ma200?: number;
  atr?: number;
  volatility?: number;
}

export interface NewsSentiment {
  score?: number;
  sentiment?: 'positive' | 'negative' | 'neutral';
  impact?: 'low' | 'medium' | 'high';
}

export interface TradingViewAlert {
  type?: 'buy' | 'sell' | 'hold' | 'alert';
  confidence?: number;
  message?: string;
}

export interface PortfolioContext {
  currentWeight?: number;
  concentrationRisk?: number;
  totalValue?: number;
  openPositions?: Array<{ symbol: string; size: number }>;
}

export interface RiskSettings {
  maxPositionSizePct?: number;
  maxDrawdownPct?: number;
  maxRiskPct?: number;
  riskRewardMin?: number;
  confidenceThreshold?: number;
}

export interface AIConsensusResult {
  recommendation?: string;
  confidence?: number;
  agreementScore?: number;
  reasons?: string[];
}

export interface DecisionOutput {
  action: DecisionAction;
  buyScore: number;
  sellScore: number;
  holdScore: number;
  confidence: number;
  risk: 'low' | 'medium' | 'high';
  entry: number;
  stopLoss: number;
  takeProfit: number;
  positionSize: number;
  explanation: string;
  reasons: string[];
  metadata: {
    marketBias: string;
    riskReward: number;
    confidenceBand: string;
  };
}

export interface DecisionInput {
  marketData: MarketData;
  aiConsensus?: AIConsensusResult;
  technical?: TechnicalIndicators;
  news?: NewsSentiment;
  alerts?: TradingViewAlert[];
  portfolio?: PortfolioContext;
  riskSettings?: RiskSettings;
}
