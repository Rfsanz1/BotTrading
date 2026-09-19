export interface DashboardSummary {
  health: Record<string, boolean>;
  usage: { totalRequests: number; totalTokens: number; totalCostUsd: number };
  performance: { avgLatencyMs: number; accuracy: number };
}

export class DashboardService {
  constructor(private memory: any, private registry: any) {}

  getSummary(): DashboardSummary {
    const responses = this.memory.list();
    const totalTokens = responses.reduce((sum: number, item: any) => sum + (item.tokenUsage || 0), 0);
    const totalCostUsd = responses.reduce((sum: number, item: any) => sum + (item.costUsd || 0), 0);
    const avgLatencyMs = responses.length ? responses.reduce((sum: number, item: any) => sum + (item.latencyMs || 0), 0) / responses.length : 0;
    const accuracy = responses.length ? responses.reduce((sum: number, item: any) => sum + (item.confidence || 0), 0) / responses.length : 0;

    return {
      health: Object.fromEntries(this.registry.list().map((p: any) => [p.id, p.metrics.healthy])),
      usage: { totalRequests: responses.length, totalTokens, totalCostUsd },
      performance: { avgLatencyMs, accuracy },
    };
  }
}

export default DashboardService;
