import { ProviderDefinition, ProviderMetrics, OrchestratorProvider, ProviderCapability } from './types';

export class ProviderRegistry {
  private providers = new Map<OrchestratorProvider, ProviderDefinition>();

  constructor() {
    this.registerDefaultProviders();
  }

  private registerDefaultProviders() {
    const providerSpecs: Array<Omit<ProviderDefinition, 'metrics'> & { metrics?: Partial<ProviderMetrics> }> = [
      {
        id: 'openai',
        name: 'openai',
        displayName: 'OpenAI',
        capabilities: { streaming: true, functionCalling: true, jsonMode: true, vision: true, local: false },
        enabled: true,
        priority: 1,
      },
      {
        id: 'claude',
        name: 'claude',
        displayName: 'Claude',
        capabilities: { streaming: true, functionCalling: true, jsonMode: true, vision: true, local: false },
        enabled: true,
        priority: 2,
      },
      {
        id: 'gemini',
        name: 'gemini',
        displayName: 'Gemini',
        capabilities: { streaming: true, functionCalling: true, jsonMode: true, vision: true, local: false },
        enabled: true,
        priority: 3,
      },
      {
        id: 'groq',
        name: 'groq',
        displayName: 'Groq',
        capabilities: { streaming: true, functionCalling: true, jsonMode: true, vision: false, local: false },
        enabled: true,
        priority: 4,
      },
      {
        id: 'deepseek',
        name: 'deepseek',
        displayName: 'DeepSeek',
        capabilities: { streaming: true, functionCalling: true, jsonMode: true, vision: false, local: false },
        enabled: true,
        priority: 5,
      },
      {
        id: 'ollama',
        name: 'ollama',
        displayName: 'Ollama',
        capabilities: { streaming: true, functionCalling: true, jsonMode: true, vision: false, local: true },
        enabled: true,
        priority: 6,
      },
    ];

    for (const spec of providerSpecs) {
      this.providers.set(spec.id, {
        ...spec,
        metrics: {
          latencyMs: 0,
          tokenUsage: 0,
          costUsd: 0,
          accuracy: 0,
          successCount: 0,
          failureCount: 0,
          lastSeenAt: Date.now(),
          healthy: true,
        },
      });
    }
  }

  list(): ProviderDefinition[] {
    return Array.from(this.providers.values());
  }

  get(id: OrchestratorProvider): ProviderDefinition | undefined {
    return this.providers.get(id);
  }

  enable(id: OrchestratorProvider) {
    const provider = this.providers.get(id);
    if (provider) provider.enabled = true;
  }

  disable(id: OrchestratorProvider) {
    const provider = this.providers.get(id);
    if (provider) provider.enabled = false;
  }

  updateMetrics(id: OrchestratorProvider, metrics: Partial<ProviderMetrics>) {
    const provider = this.providers.get(id);
    if (!provider) return;
    provider.metrics = { ...provider.metrics, ...metrics };
  }

  getHealthyProviders(): ProviderDefinition[] {
    return this.list().filter((p) => p.enabled && p.metrics.healthy);
  }
}

export default ProviderRegistry;
