import { ProviderRegistry } from './provider-registry';
import { AIRequest, AIResponse, OrchestratorProvider } from './types';
import { createProvider } from '../factory';

export class ProviderManager {
  private readonly maxRetries: number;

  constructor(private registry: ProviderRegistry, maxRetries = 2) {
    this.maxRetries = maxRetries;
  }

  async execute(request: AIRequest, provider: OrchestratorProvider): Promise<AIResponse> {
    const definition = this.registry.get(provider);
    if (!definition || !definition.enabled) {
      throw new Error(`Provider ${provider} is unavailable`);
    }

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const start = Date.now();
        const providerInstance = createProvider(provider as any);
        const messages = request.messages.map((m) => ({
          id: `${Date.now()}-${Math.random()}`,
          role: m.role as any,
          content: m.content,
          timestamp: Date.now(),
          meta: m.metadata,
        }));

        const result = await providerInstance.sendMessage(request.conversationId, messages as any, undefined);
        const latency = Date.now() - start;

        const response: AIResponse = {
          provider,
          model: definition.model || provider,
          content: result.content,
          latencyMs: latency,
          tokenUsage: Math.max(50, Math.round(result.content.length / 4)),
          costUsd: Math.max(0.0001, latency / 1000 * 0.001),
          confidence: 0.7,
          success: true,
          timestamp: Date.now(),
          stream: Boolean(request.stream),
          metadata: { mode: request.mode || 'text' },
        };

        this.registry.updateMetrics(provider, {
          latencyMs: latency,
          tokenUsage: response.tokenUsage,
          costUsd: response.costUsd,
          accuracy: 0.7,
          successCount: (definition.metrics.successCount || 0) + 1,
          lastSeenAt: Date.now(),
          healthy: true,
        });

        return response;
      } catch (error) {
        lastError = error;
        this.registry.updateMetrics(provider, {
          failureCount: (definition.metrics.failureCount || 0) + 1,
          healthy: false,
        });
        if (attempt < this.maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
        }
      }
    }

    throw lastError || new Error(`Provider ${provider} failed after retries`);
  }

  getBestProvider(request: AIRequest): OrchestratorProvider {
    const healthy = this.registry.getHealthyProviders().sort((a, b) => a.priority - b.priority);
    if (healthy.length === 0) return 'ollama';
    return healthy[0].id;
  }
}

export default ProviderManager;
