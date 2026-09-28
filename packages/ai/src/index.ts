// Canonical production AI package surface.
// Legacy direct-provider modules are intentionally excluded from the public build
// so the runtime decision path remains RouterService -> 9Router only.
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
export { AIManager } from './core/ai.manager';
export { AIService as AIEngineService } from './core/ai.service';
export * from './router';
export { AIModule } from './ai.module';
export type { AIModuleOptions } from './ai.module';
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
