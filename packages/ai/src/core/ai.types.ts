// ─── OpenAI-compatible types (9Router speaks this protocol) ──────────────────

export type AIRole = 'system' | 'user' | 'assistant';

// ─── Chat ────────────────────────────────────────────────────────────────────

export interface AIMessage {
  role: AIRole;
  content: string;
}

export interface AIChatRequest {
  model: string;
  messages: AIMessage[];
  temperature?: number;
  max_tokens?: number;
  stream?: boolean;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stop?: string | string[] | null;
  user?: string;
}

export interface AITokenUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface AIChoice {
  index: number;
  message: AIMessage;
  finish_reason: string | null;
}

export interface AIChatResponse {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: AIChoice[];
  usage: AITokenUsage;
}

// ─── Streaming ───────────────────────────────────────────────────────────────

export interface AIStreamDelta {
  role?: AIRole;
  content?: string;
}

export interface AIStreamChoice {
  index: number;
  delta: AIStreamDelta;
  finish_reason: string | null;
}

export interface AIStreamChunk {
  id: string;
  object: 'chat.completion.chunk';
  created: number;
  model: string;
  choices: AIStreamChoice[];
}

// ─── Models ──────────────────────────────────────────────────────────────────

export interface AIModel {
  id: string;
  object: 'model';
  created: number;
  owned_by: string;
}

export interface AIModelsResponse {
  object: 'list';
  data: AIModel[];
}

// ─── Embeddings ──────────────────────────────────────────────────────────────

export interface AIEmbeddingRequest {
  model?: string;
  input: string | string[];
  encoding_format?: 'float' | 'base64';
}

export interface AIEmbeddingObject {
  object: 'embedding';
  index: number;
  embedding: number[];
}

export interface AIEmbeddingResponse {
  object: 'list';
  data: AIEmbeddingObject[];
  model: string;
  usage: { prompt_tokens: number; total_tokens: number };
}

// ─── Health ──────────────────────────────────────────────────────────────────

export type AIHealthState = 'ok' | 'degraded' | 'down';

export interface AIHealthStatus {
  status: AIHealthState;
  latencyMs: number;
  model: string;
  baseUrl: string;
  checkedAt: number;
}

// ─── Manager options ─────────────────────────────────────────────────────────

export interface AIManagerOptions {
  model?: string;
  retries?: number;
  timeoutMs?: number;
  temperature?: number;
  maxTokens?: number;
}

export type AIResponseStatus = 'success' | 'retried' | 'timeout' | 'error';

export interface AIManagerResult {
  response: AIChatResponse;
  latencyMs: number;
  attempts: number;
  status: AIResponseStatus;
  model: string;
}

// ─── Trading domain types ─────────────────────────────────────────────────────

export type TradingAction = 'BUY' | 'SELL' | 'HOLD';
export type RiskLevel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type Urgency = 'LOW' | 'MEDIUM' | 'HIGH';

export interface MarketContext {
  symbol: string;
  interval: string;
  currentPrice: number;
  volume24h?: number;
  priceChange24hPct?: number;
  indicators: {
    rsi?: number;
    macd?: number;
    macdSignal?: number;
    ema20?: number;
    ema50?: number;
    ema200?: number;
    atr?: number;
    adx?: number;
    bollingerUpper?: number;
    bollingerMid?: number;
    bollingerLower?: number;
  };
  recentCandles?: Array<{
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
    timestamp: number;
  }>;
  trend?: 'UPTREND' | 'DOWNTREND' | 'SIDEWAYS';
  additionalContext?: string;
}

export interface AITradingSignal {
  action: TradingAction;
  confidence: number; // 0–100
  reasoning: string;
  stopLoss?: number;
  takeProfit?: number;
  positionSizePct?: number; // % of capital
  urgency?: Urgency;
  validForSeconds?: number;
}

export interface AIRiskAssessment {
  riskLevel: RiskLevel;
  maxDrawdownPct: number;
  recommendation: string;
  shouldProceed: boolean;
  warnings: string[];
  suggestedSizePct?: number;
}

export interface AIScoreResult {
  score: number; // 0–100
  confidence: number;
  reasoning: string;
  tags: string[];
}

export interface ConversationMemoryEntry {
  id: string;
  role: AIRole;
  content: string;
  timestamp: number;
  metadata?: Record<string, string | number | boolean>;
}

export interface ConversationMemory {
  conversationId: string;
  entries: ConversationMemoryEntry[];
  createdAt: number;
  updatedAt: number;
}
