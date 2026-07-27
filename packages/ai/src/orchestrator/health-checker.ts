import { ProviderRegistry } from './provider-registry';
import { OrchestratorProvider } from './types';

export class HealthChecker {
  constructor(private registry: ProviderRegistry) {}

  async check(provider: OrchestratorProvider): Promise<boolean> {
    const definition = this.registry.get(provider);
    if (!definition || !definition.enabled) return false;
    const healthy = Boolean(definition.metrics.healthy);
    this.registry.updateMetrics(provider, { healthy });
    return healthy;
  }

  async runAll(): Promise<Record<OrchestratorProvider, boolean>> {
    const results: Record<string, boolean> = {};
    for (const provider of this.registry.list()) {
      results[provider.id] = await this.check(provider.id as OrchestratorProvider);
    }
    return results as Record<OrchestratorProvider, boolean>;
  }
}

export default HealthChecker;
