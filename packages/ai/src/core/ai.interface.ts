import {
  AIMessage,
  AIChatResponse,
  AIStreamChunk,
  AIManagerOptions,
  AIManagerResult,
  AIHealthStatus,
  AIModel,
  MarketContext,
  AITradingSignal,
  AIRiskAssessment,
} from './ai.types';

// ─── Router-level contract ────────────────────────────────────────────────────

/**
 * Low-level contract for interacting with the 9Router gateway.
 * Implementations must route ALL traffic through 9Router — never call
 * individual AI SDKs directly.
 */
export interface IRouterService {
  /**
   * Send a synchronous chat request. Returns a single completed response.
   */
  chat(messages: AIMessage[], options?: AIManagerOptions): Promise<AIChatResponse>;

  /**
   * Send a streaming chat request. Yields SSE chunks as they arrive.
   */
  stream(messages: AIMessage[], options?: AIManagerOptions): AsyncGenerator<AIStreamChunk, void, unknown>;

  /**
   * List all models available on the 9Router instance.
   */
  listModels(): Promise<AIModel[]>;

  /**
   * Ping the gateway and return a health snapshot.
   */
  health(): Promise<AIHealthStatus>;
}

// ─── Manager-level contract ───────────────────────────────────────────────────

/**
 * Orchestrates model selection, retry, timeout, and logging.
 * Consumers should depend on IAIManager, not concrete classes.
 */
export interface IAIManager {
  /**
   * Execute a chat prompt with retry + timeout.
   * Returns enriched metadata alongside the raw AI response.
   */
  execute(messages: AIMessage[], options?: AIManagerOptions): Promise<AIManagerResult>;

  /**
   * Stream a chat prompt. Caller iterates the async generator.
   */
  executeStream(messages: AIMessage[], options?: AIManagerOptions): AsyncGenerator<AIStreamChunk, void, unknown>;

  /**
   * Probe the underlying router and return its health state.
   */
  healthCheck(): Promise<AIHealthStatus>;
}

// ─── Service-level contract ───────────────────────────────────────────────────

/**
 * High-level AI service with trading-aware methods.
 * Composes prompts and delegates to IAIManager.
 */
export interface IAIService {
  /**
   * Analyse market data and produce a trading signal.
   */
  analyseMarket(ctx: MarketContext, options?: AIManagerOptions): Promise<AITradingSignal>;

  /**
   * Assess risk for a proposed trade.
   */
  assessRisk(ctx: MarketContext, signal: AITradingSignal, options?: AIManagerOptions): Promise<AIRiskAssessment>;

  /**
   * Free-form chat with the AI (for Telegram bot commands, etc.).
   */
  chat(userMessage: string, history?: AIMessage[], options?: AIManagerOptions): Promise<string>;
}
