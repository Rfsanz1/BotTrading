// ─── Existing modules (preserved) ────────────────────────────────────────────
export * from './types';
export * from './factory';
export * from './prompt/templates';
export * from './ai.service';
export * from './trading-brain';
export * from './trading-planner';
export * from './orchestrator';
export * from './decision-engine';
export * from './strategy-engine';
export * from './portfolio-intelligence';

// ─── 9Router AI Engine (Tahap 3) ─────────────────────────────────────────────
// Export types and interfaces first (no naming conflicts with legacy modules)
export type {
  AIRole,
  AIMessage,
  AIChatRequest,
  AITokenUsage,
  AIChoice,
  AIChatResponse,
  AIStreamDelta,
  AIStreamChoice,
  AIStreamChunk,
  AIModel,
  AIModelsResponse,
  AIEmbeddingRequest,
  AIEmbeddingObject,
  AIEmbeddingResponse,
  AIHealthState,
  AIHealthStatus,
  AIManagerOptions,
  AIResponseStatus,
  AIManagerResult,
  TradingAction,
  RiskLevel,
  Urgency,
  MarketContext,
  AITradingSignal,
  AIRiskAssessment,
  AIScoreResult,
  ConversationMemoryEntry,
  ConversationMemory,
} from './core/ai.types';
export type { IAIManager, IAIService, IRouterService } from './core/ai.interface';
// AIManager and AIService — export under new names to avoid clash with legacy AIService
export { AIManager } from './core/ai.manager';
export { AIService as AIEngineService } from './core/ai.service';
export * from './router';
export { ConversationMemoryStore } from './memory';
export { AIResponseScorer }        from './scoring';
export type { ScoringWeights }     from './scoring';
export { EmbeddingsService }       from './embeddings';
export type { EmbeddingOptions }   from './embeddings';
export { AIModule }                from './ai.module';
export type { AIModuleOptions }    from './ai.module';
export {
  withRetry,
  withTimeout,
  parseSSELine,
  extractJsonBlock,
  clamp,
  truncate,
  sleep,
} from './utils';
export type { RetryOptions } from './utils';

// ─── Prompts ─────────────────────────────────────────────────────────────────
export { SystemPrompt }   from './prompts/system.prompt';
export { MarketPrompt }   from './prompts/market.prompt';
export { TradingPrompt }  from './prompts/trading.prompt';
export { RiskPrompt }     from './prompts/risk.prompt';
export { TelegramPrompt } from './prompts/telegram.prompt';
