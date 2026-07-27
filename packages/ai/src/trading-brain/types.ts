/**
 * AI Trading Brain Types
 * Core type definitions for the trading brain analysis and recommendation system
 */

// ============ ANALYSIS TYPES ============

export interface TechnicalIndicators {
  rsi?: number; // Relative Strength Index (0-100)
  macd?: { line: number; signal: number; histogram: number };
  movingAverages?: { ma20: number; ma50: number; ma200: number };
  bollingerBands?: { upper: number; middle: number; lower: number };
  atr?: number; // Average True Range
  stochastic?: { k: number; d: number };
  obv?: number; // On-Balance Volume
  adx?: number; // Average Directional Index
  trend?: 'bullish' | 'bearish' | 'neutral';
  strength?: number; // 0-1
  signals?: string[];
}

export interface TradingViewAlert {
  id: string;
  symbol: string;
  message: string;
  timestamp: number;
  source: string;
  type: 'buy' | 'sell' | 'hold' | 'alert';
  confidence?: number;
  indicators?: string[];
}

export interface NewsSentiment {
  symbol: string;
  sentiment: 'positive' | 'negative' | 'neutral';
  score: number; // -1 to 1
  sources: NewsSource[];
  overallScore: number;
  trend: 'improving' | 'declining' | 'stable';
  impact: 'high' | 'medium' | 'low';
}

export interface NewsSource {
  source: string;
  sentiment: string;
  score: number;
  headline: string;
  url?: string;
  timestamp: number;
}

export interface MarketStructure {
  trend: 'uptrend' | 'downtrend' | 'ranging';
  support: number[];
  resistance: number[];
  breakoutLevel?: number;
  breakdownLevel?: number;
  pattern?: 'flag' | 'triangle' | 'wedge' | 'channel' | 'other';
  strength: number; // 0-1
  signals: string[];
}

export interface VolumeAnalysis {
  volume24h: number;
  volumeChange: number; // percentage
  volumeTrend: 'increasing' | 'decreasing' | 'stable';
  onBalanceVolume: number;
  priceVolumeCorrelation: number; // -1 to 1
  volumeProfile?: Record<string, number>;
  signals: string[];
}

export interface LiquidityAnalysis {
  bidAskSpread: number;
  spreadPercentage: number;
  liquidityScore: number; // 0-1
  orderBook?: {
    bids: [price: number, size: number][];
    asks: [price: number, size: number][];
  };
  impact: 'low' | 'medium' | 'high';
  signals: string[];
}

export interface OrderFlowAnalysis {
  buyVolume: number;
  sellVolume: number;
  buyPressure: number; // 0-1
  sellPressure: number; // 0-1
  netFlow: number;
  flowTrend: 'buy' | 'sell' | 'neutral';
  accumulation: 'up' | 'down' | 'neutral';
  signals: string[];
}

export interface HistoricalPerformance {
  symbol: string;
  period: '1h' | '4h' | '1d' | '1w' | '1m';
  return: number; // percentage
  volatility: number;
  maxDrawdown: number;
  sharpeRatio?: number;
  winRate?: number; // percentage
  signals: string[];
}

export interface PortfolioExposure {
  symbol: string;
  currentWeight: number; // percentage of portfolio
  maxAllowedWeight: number;
  correlationWithPortfolio: number; // -1 to 1
  concentrationRisk: number; // 0-1
  diversificationScore: number; // 0-1
}

export interface OpenPosition {
  symbol: string;
  side: 'long' | 'short';
  size: number;
  entryPrice: number;
  currentPrice: number;
  unrealizedPnL: number;
  unrealizedPnLPercentage: number;
  duration: number; // milliseconds
  riskRewardRatio: number;
}

export interface RiskAnalysis {
  overallRisk: 'low' | 'medium' | 'high';
  riskScore: number; // 0-1
  var95?: number; // Value at Risk
  maxDrawdown: number;
  portfolioHeat: number; // total exposure as percentage
  concentration: number; // 0-1
  correlationRisk: number; // 0-1
  liquidityRisk: number; // 0-1
  signals: string[];
}

// ============ RECOMMENDATION TYPES ============

export interface TradeRecommendation {
  id: string;
  timestamp: number;
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD' | 'CLOSE';
  entryPrice?: number;
  exitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  position: OpenPosition | null;
  confidence: number; // 0-1
  riskRewardRatio: number;
  reasoning: string;
  explanations: RecommendationExplanation[];
  sources: AnalysisSource[];
  consensusDetails?: ConsensusDetails;
  risks: RiskWarning[];
  alternativeActions?: TradeRecommendation[];
}

export interface RecommendationExplanation {
  source: string;
  explanation: string;
  confidence: number;
  keyFactors: string[];
}

export interface AnalysisSource {
  type: 'technical' | 'sentiment' | 'fundamental' | 'order_flow' | 'volume';
  name: string;
  confidence: number;
  signals: string[];
}

export interface ConsensusDetails {
  providers: {
    name: string;
    recommendation: string;
    confidence: number;
    reasoning: string;
  }[];
  aggregationMethod: string;
  agreementScore: number; // 0-1
  dissent?: string[];
}

export interface RiskWarning {
  level: 'low' | 'medium' | 'high';
  message: string;
  mitigation?: string;
}

// ============ LEARNING TYPES ============

export interface TradeHistory {
  id: string;
  timestamp: number;
  recommendation: TradeRecommendation;
  executedAction?: 'BUY' | 'SELL' | 'HOLD' | 'NONE';
  executedPrice?: number;
  executedSize?: number;
  result?: TradeResult;
  outcome: 'win' | 'loss' | 'neutral' | 'pending';
  lessons?: string[];
}

export interface TradeResult {
  entryPrice: number;
  exitPrice: number;
  size: number;
  pnl: number;
  pnlPercentage: number;
  duration: number;
  exitReason: string;
  slippage: number;
}

export interface LearningRecord {
  id: string;
  period: string; // YYYY-MM
  symbol: string;
  successRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  totalTrades: number;
  insights: Insight[];
  improvements: string[];
  lastUpdated: number;
}

export interface Insight {
  category: string;
  observation: string;
  confidence: number;
  recommendation: string;
}

// ============ TEMPLATE TYPES ============

export interface PromptTemplate {
  id: string;
  name: string;
  description: string;
  category: 'analysis' | 'recommendation' | 'explanation' | 'learning';
  template: string; // mustache template
  variables: TemplateVariable[];
  examples?: Example[];
  isCustom: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TemplateVariable {
  name: string;
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  required: boolean;
  default?: any;
}

export interface Example {
  input: Record<string, any>;
  output: string;
  description: string;
}

export interface StrategyTemplate {
  id: string;
  name: string;
  description: string;
  rules: StrategyRule[];
  parameters: StrategyParameter[];
  indicators: string[];
  riskManagement: RiskManagementRule[];
  backtest?: BacktestResult;
  isActive: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StrategyRule {
  condition: string;
  action: string;
  weight: number; // 0-1
}

export interface StrategyParameter {
  name: string;
  value: any;
  type: string;
  min?: number;
  max?: number;
  description: string;
}

export interface RiskManagementRule {
  type: 'max_position' | 'max_loss' | 'take_profit' | 'stop_loss' | 'correlation_check';
  threshold: number;
  action: string;
}

export interface BacktestResult {
  period: string;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  returnPercentage: number;
}

// ============ BRAIN TYPES ============

export interface TradingBrainInput {
  symbol: string;
  portfolio: PortfolioExposure;
  technical?: TechnicalIndicators;
  tradingViewAlerts?: TradingViewAlert[];
  newsSentiment?: NewsSentiment;
  marketStructure?: MarketStructure;
  volume?: VolumeAnalysis;
  liquidity?: LiquidityAnalysis;
  orderFlow?: OrderFlowAnalysis;
  historical?: HistoricalPerformance;
  openPositions?: OpenPosition[];
  risk?: RiskAnalysis;
  customContext?: Record<string, any>;
}

export interface TradingBrainOutput {
  recommendation: TradeRecommendation;
  analysis: {
    technical: TechnicalIndicators | null;
    sentiment: NewsSentiment | null;
    structure: MarketStructure | null;
    volume: VolumeAnalysis | null;
    liquidity: LiquidityAnalysis | null;
    orderFlow: OrderFlowAnalysis | null;
    risk: RiskAnalysis | null;
  };
  metadata: {
    processingTime: number;
    analysisCount: number;
    confidenceFactors: string[];
  };
}

export interface BrainConfig {
  providers: string[];
  analysisTypes: string[];
  minConfidenceThreshold: number;
  useConsensus: boolean;
  learnFromTrades: boolean;
  customPrompts?: string[];
  customStrategies?: string[];
  riskManagementProfile: 'conservative' | 'moderate' | 'aggressive';
}
