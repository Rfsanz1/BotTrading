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
    this.conversationManager.createConversation(request.conversationId);
    this.conversationManager.append(request.conversationId, { role: 'user', content: request.messages[0]?.content || '' });

    const prompt = this.promptManager.render('analysis', {
      symbol: request.metadata?.symbol || 'unknown',
      mode: request.mode || 'text',
    });

    const primaryProvider = request.providerHint || this.providerManager.getBestProvider(request);
    const providersToTry: OrchestratorProvider[] = [primaryProvider];

    if (request.requireConsensus) {
      providersToTry.push(...this.registry.getHealthyProviders().map((p) => p.id).filter((p) => p !== primaryProvider));
    }

    try {
      const response = await this.providerManager.execute({ ...request, messages: [{ role: 'system', content: prompt }, ...request.messages] }, primaryProvider);
      this.memory.store(response);
      if (!request.requireConsensus) return response;

      const others = [] as AIResponse[];
      for (const provider of providersToTry.slice(1)) {
        try {
          const other = await this.providerManager.execute({ ...request, messages: [{ role: 'system', content: prompt }, ...request.messages] }, provider);
          others.push(other);
          this.memory.store(other);
        } catch (error) {
          this.fallbackEngine.handle(provider, String(error));
        }
      }

      const all = [response, ...others];
      const consensus = this.consensusEngine.buildConsensus(all);
      return { consensus, responses: all };
    } catch (error) {
      const fallback = this.fallbackEngine.getFallback(primaryProvider);
      if (fallback && request.allowFallback !== false) {
        const fallbackResponse = await this.providerManager.execute({ ...request, messages: [{ role: 'system', content: prompt }, ...request.messages] }, fallback);
        this.memory.store(fallbackResponse);
        return fallbackResponse;
      }
      throw error;
    }
  }
}

export default RoutingEngine;
