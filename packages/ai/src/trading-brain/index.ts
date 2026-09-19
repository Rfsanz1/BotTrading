/**
 * AI Trading Brain - Exports
 */

// Types
export * from './types';

// Analysis Engines
export {
  TechnicalAnalysisEngine,
  TradingViewAlertAnalyzer,
  SentimentAnalysisEngine,
  MarketStructureAnalyzer,
  VolumeAnalysisEngine,
  LiquidityAnalyzer,
  RiskAnalysisEngine,
} from './analysis-engines';

// Consensus and Scoring
export { ConsensusEngine, ConfidenceScorer } from './consensus-engine';

// Learning System
export { LearningSystem, TradeResultAnalyzer } from './learning-system';

// Explanation Engine
export { ExplanationEngine, AnalysisReporter } from './explanation-engine';

// Templates
export { PromptTemplateManager, StrategyTemplateManager } from './template-manager';

// Main Brain
export { AITradingBrain } from './trading-brain';

// Decision Engine
export { TradingDecisionEngine } from '../decision-engine';
