export type OrchestratorProvider = 'openai' | 'claude' | 'gemini' | 'groq' | 'deepseek' | 'ollama';

export interface ProviderCapability {
  streaming: boolean;
  functionCalling: boolean;
  jsonMode: boolean;
  vision: boolean;
  local: boolean;
}

export interface ProviderMetrics {
  latencyMs: number;
  tokenUsage: number;
  costUsd: number;
  accuracy: number;
  successCount: number;
  failureCount: number;
  lastSeenAt: number;
  healthy: boolean;
}

export interface ProviderDefinition {
  id: OrchestratorProvider;
  name: string;
  displayName: string;
  capabilities: ProviderCapability;
  enabled: boolean;
  endpoint?: string;
  apiKey?: string;
  model?: string;
  priority: number;
  metrics: ProviderMetrics;
}

export interface PromptTemplate {
  id: string;
  name: string;
  template: string;
  category: string;
  variables?: string[];
}

export interface ModelDefinition {
  id: string;
  provider: OrchestratorProvider;
  name: string;
  capabilities: ProviderCapability;
  enabled: boolean;
  default: boolean;
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  metadata?: Record<string, any>;
}

export interface AIRequest {
  conversationId: string;
  messages: ChatMessage[];
  providerHint?: OrchestratorProvider;
  requireConsensus?: boolean;
  allowFallback?: boolean;
  stream?: boolean;
  mode?: 'text' | 'json' | 'function' | 'vision';
  temperature?: number;
  maxTokens?: number;
  metadata?: Record<string, any>;
}

export interface AIResponse {
  provider: OrchestratorProvider;
  model: string;
  content: string;
  raw?: any;
  latencyMs: number;
  tokenUsage: number;
  costUsd: number;
  confidence: number;
  success: boolean;
  timestamp: number;
  stream?: boolean;
  metadata?: Record<string, any>;
}

export interface ConsensusResult {
  providerResponses: AIResponse[];
  consensus: string;
  confidence: number;
  agreementScore: number;
  winner: OrchestratorProvider;
  reasons: string[];
  timestamp: number;
}

export interface OrchestratorConfig {
  providers?: OrchestratorProvider[];
  defaultProvider?: OrchestratorProvider;
  requireConsensus?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
  enableLoadBalancing?: boolean;
  enableStreaming?: boolean;
  enableFallback?: boolean;
  enableHealthChecks?: boolean;
  healthCheckIntervalMs?: number;
}
