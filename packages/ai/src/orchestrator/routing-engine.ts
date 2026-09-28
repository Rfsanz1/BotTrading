import { AIRequest, AIResponse, OrchestratorProvider } from './types';
import { ProviderManager } from './provider-manager';
import { ProviderRegistry } from './provider-registry';
import { PromptManager } from './prompt-manager';
import { ModelManager } from './model-manager';
import { ConversationManager } from './conversation-manager';
import { AIMemory } from './ai-memory';
import { ConsensusEngine } from './consensus-engine';
import { FallbackEngine } from './fallback-engine';
import { HealthChecker } from './health-checker';

export class RoutingEngine {
  constructor(
    private registry: ProviderRegistry,
    private providerManager: ProviderManager,
    private promptManager: PromptManager,
    private modelManager: ModelManager,
    private conversationManager: ConversationManager,
    private memory: AIMemory,
    private consensusEngine: ConsensusEngine,
    private fallbackEngine: FallbackEngine,
    private healthChecker: HealthChecker,
  ) {}

  async route(request: AIRequest): Promise<AIResponse | { consensus: any; responses: AIResponse[] }> {
    throw new Error('Legacy orchestrator routing is disabled in production. Use the canonical RouterService path.');
  }
}

export default RoutingEngine;
