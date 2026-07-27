import type { OrchestratorProvider, ProviderDefinition } from './types';
import type { DashboardSummary } from './dashboard';

export interface ServiceHealthCheckResult {
  name: string;
  healthy: boolean;
  latencyMs?: number;
  message: string;
  details?: Record<string, any>;
  timestamp: number;
}

export type ServiceHealthCheckMap = Record<string, () => Promise<ServiceHealthCheckResult>>;

export type WorkerRestarterMap = Record<string, (instanceId?: string) => Promise<boolean>>;

export type SupervisorAlertSeverity = 'critical' | 'warning' | 'info';

export interface SupervisorAlert {
  source: string;
  severity: SupervisorAlertSeverity;
  message: string;
  timestamp: number;
  details?: Record<string, any>;
}

export interface SupervisorReport {
  providers: ProviderDefinition[];
  services: ServiceHealthCheckResult[];
  healthyProviders: number;
  unhealthyProviders: number;
  healthyServices: number;
  unhealthyServices: number;
  summary: {
    healthy: boolean;
    message: string;
  };
  timestamp: number;
}

export interface SupervisorArchitecturePlan {
  summary: string;
  components: Array<{ name: string; responsibility: string; recommendedDeployment: string }>;
  services: Array<{
    name: string;
    type: 'database' | 'cache' | 'queue' | 'integration' | 'ai' | 'monitoring';
    description: string;
  }>;
  recommendations: string[];
}

export interface SupervisorOptions {
  serviceHealthChecks?: ServiceHealthCheckMap;
  alertHandler?: (alerts: SupervisorAlert[]) => Promise<void>;
  workerRestarters?: WorkerRestarterMap;
  architecturePlan?: Partial<SupervisorArchitecturePlan>;
  providerFailureThreshold?: number;
}
