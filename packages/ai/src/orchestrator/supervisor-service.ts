import { ProviderRegistry } from './provider-registry';
import { ProviderManager } from './provider-manager';
import { DashboardService } from './dashboard';
import type { OrchestratorProvider, ProviderDefinition } from './types';
import type {
  ServiceHealthCheckResult,
  ServiceHealthCheckMap,
  WorkerRestarterMap,
  SupervisorAlert,
  SupervisorReport,
  SupervisorArchitecturePlan,
  SupervisorOptions,
} from './supervisor-types';

const DEFAULT_PROVIDER_FAILURE_THRESHOLD = 3;

export class SupervisorService {
  private serviceHealthChecks: ServiceHealthCheckMap;
  private workerRestarters: WorkerRestarterMap;
  private alertHandler: (alerts: SupervisorAlert[]) => Promise<void>;
  private providerFailureThreshold: number;
  private alerts: SupervisorAlert[] = [];
  private lastReport: SupervisorReport | null = null;

  constructor(
    private readonly registry: ProviderRegistry,
    private readonly providerManager: ProviderManager,
    private readonly dashboard: DashboardService,
    options: SupervisorOptions = {},
  ) {
    this.serviceHealthChecks = options.serviceHealthChecks || {};
    this.workerRestarters = options.workerRestarters || {};
    this.alertHandler = options.alertHandler || (async (alerts) => { console.warn('Supervisor alerts', alerts); });
    this.providerFailureThreshold = options.providerFailureThreshold ?? DEFAULT_PROVIDER_FAILURE_THRESHOLD;
  }

  async runHealthChecks(): Promise<SupervisorReport> {
    const providers = await this.checkProviders();
    const services = await this.checkServices();

    const healthyProviders = providers.filter((provider) => provider.metrics.healthy).length;
    const unhealthyProviders = providers.length - healthyProviders;
    const healthyServices = services.filter((service) => service.healthy).length;
    const unhealthyServices = services.length - healthyServices;

    const summary = {
      healthy: unhealthyProviders === 0 && unhealthyServices === 0,
      message:
        unhealthyProviders === 0 && unhealthyServices === 0
          ? 'All monitored systems are healthy.'
          : `Detected ${unhealthyProviders} unhealthy providers and ${unhealthyServices} unhealthy services.`,
    };

    const report: SupervisorReport = {
      providers,
      services,
      healthyProviders,
      unhealthyProviders,
      healthyServices,
      unhealthyServices,
      summary,
      timestamp: Date.now(),
    };

    this.lastReport = report;
    await this.createAlerts(report);
    return report;
  }

  async checkProviders(): Promise<ProviderDefinition[]> {
    const providers = this.registry.list();

    for (const provider of providers) {
      const healthy = provider.metrics.healthy;
      if (!healthy) {
        provider.metrics.failureCount = (provider.metrics.failureCount || 0) + 1;
      }

      if (provider.metrics.failureCount >= this.providerFailureThreshold && provider.enabled) {
        provider.enabled = false;
        await this.publishAlert({
          source: provider.id,
          severity: 'warning',
          message: `Provider ${provider.displayName} has failed ${provider.metrics.failureCount} times and has been disabled for failover.`,
          timestamp: Date.now(),
          details: { provider },
        });
      }
    }

    return providers;
  }

  async checkServices(): Promise<ServiceHealthCheckResult[]> {
    const results = await Promise.all(
      Object.entries(this.serviceHealthChecks).map(async ([name, check]) => {
        try {
          return await check();
        } catch (error) {
          return {
            name,
            healthy: false,
            latencyMs: undefined,
            message: `Service health check failed: ${(error as Error).message}`,
            details: { error: error instanceof Error ? error.message : String(error) },
            timestamp: Date.now(),
          };
        }
      }),
    );

    for (const service of results) {
      if (!service.healthy) {
        await this.publishAlert({
          source: service.name,
          severity: 'critical',
          message: `Service ${service.name} is unhealthy: ${service.message}`,
          timestamp: Date.now(),
          details: service.details,
        });
      }
    }

    return results;
  }

  async attemptRestarts(): Promise<Record<string, boolean>> {
    const restartResults: Record<string, boolean> = {};
    for (const [name, restarter] of Object.entries(this.workerRestarters)) {
      try {
        restartResults[name] = await restarter();
        if (restartResults[name]) {
          await this.publishAlert({
            source: name,
            severity: 'info',
            message: `Restarted worker ${name} successfully.`,
            timestamp: Date.now(),
          });
        }
      } catch (error) {
        restartResults[name] = false;
        await this.publishAlert({
          source: name,
          severity: 'warning',
          message: `Worker restart failed for ${name}: ${(error as Error).message}`,
          timestamp: Date.now(),
          details: { error: error instanceof Error ? error.message : String(error) },
        });
      }
    }

    return restartResults;
  }

  async switchProvider(from: OrchestratorProvider, to: OrchestratorProvider): Promise<boolean> {
    const fromDefinition = this.registry.get(from);
    const toDefinition = this.registry.get(to);
    if (!fromDefinition || !toDefinition) return false;

    if (fromDefinition.enabled && !toDefinition.enabled) {
      await this.publishAlert({
        source: 'provider-switch',
        severity: 'warning',
        message: `Cannot switch from ${from} to disabled provider ${to}.`,
        timestamp: Date.now(),
      });
      return false;
    }

    fromDefinition.enabled = false;
    toDefinition.enabled = true;
    await this.publishAlert({
      source: 'provider-switch',
      severity: 'info',
      message: `Switched AI provider from ${from} to ${to}.`,
      timestamp: Date.now(),
      details: { from, to },
    });
    return true;
  }

  async getDashboard(): Promise<DashboardSummary> {
    return this.dashboard.getSummary();
  }

  getLastReport(): SupervisorReport | null {
    return this.lastReport;
  }

  async getArchitecturePlan(): Promise<SupervisorArchitecturePlan> {
    return {
      summary: 'Production-ready AI trading architecture for resilient monitoring, provider failover, and trade execution orchestration.',
      components: [
        {
          name: 'AI Orchestrator',
          responsibility: 'Routes requests, performs health checks, and manages provider failover.',
          recommendedDeployment: 'Kubernetes deployment behind an API gateway',
        },
        {
          name: 'AI Provider Registry',
          responsibility: 'Tracks provider health, performance, and failover logic.',
          recommendedDeployment: 'Stateful service within orchestrator runtime',
        },
        {
          name: 'Redis Cache / Broker',
          responsibility: 'Caches session context, queues tasks, and stores realtime service state.',
          recommendedDeployment: 'Managed Redis cluster with replicas',
        },
        {
          name: 'PostgreSQL',
          responsibility: 'Persists memory, audit logs, trade history, and metrics.',
          recommendedDeployment: 'Managed PostgreSQL with automated backups and read replicas',
        },
        {
          name: 'BullMQ Workers',
          responsibility: 'Processes jobs for trading signals, alerting, and execution.',
          recommendedDeployment: 'Worker pool with auto-scaling and restart policies',
        },
        {
          name: 'Telegram Notification Service',
          responsibility: 'Sends alerts, orders, and critical incident notifications.',
          recommendedDeployment: 'Containerized service with retry logic',
        },
        {
          name: 'TradingView Integration',
          responsibility: 'Receives webhooks and routes market alerts into the trading workflow.',
          recommendedDeployment: 'Serverless or containerized webhook endpoint',
        },
        {
          name: 'Ollama Local Model Host',
          responsibility: 'Hosts local AI inference for low-latency failover and embeddings.',
          recommendedDeployment: 'Dedicated inference host or VM with GPU support',
        },
      ],
      services: [
        { name: 'PostgreSQL', type: 'database', description: 'Primary trade and memory store' },
        { name: 'Redis', type: 'cache', description: 'Session cache and BullMQ broker' },
        { name: 'BullMQ', type: 'queue', description: 'Task processing and worker orchestration' },
        { name: 'Telegram', type: 'integration', description: 'Alerting and user notifications' },
        { name: 'TradingView', type: 'integration', description: 'External market event source' },
        { name: 'Ollama', type: 'ai', description: 'Local model provider for embeddings and failover' },
        { name: 'AI Providers', type: 'ai', description: 'Cloud and local LLM providers with health failover' },
      ],
      recommendations: [
        'Use managed Redis and PostgreSQL with replication and backups.',
        'Expose a health dashboard backed by regular service health checks.',
        'Implement automated worker restart policies in the queue layer.',
        'Fail over from cloud AI providers to Ollama when provider health degrades.',
        'Send critical alerts to Telegram and audit them in PostgreSQL.',
      ],
    };
  }

  async publishAlert(alert: SupervisorAlert): Promise<void> {
    this.alerts.push(alert);
    await this.alertHandler([alert]);
  }

  async getAlerts(): Promise<SupervisorAlert[]> {
    return this.alerts.slice(-100);
  }
}
