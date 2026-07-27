import { ProviderRegistry } from './provider-registry';
import { ProviderManager } from './provider-manager';
import { PromptManager } from './prompt-manager';
import { ModelManager } from './model-manager';
import { ConversationManager } from './conversation-manager';
import { AIMemory } from './ai-memory';
import { ConsensusEngine } from './consensus-engine';
import { FallbackEngine } from './fallback-engine';
import { HealthChecker } from './health-checker';
import { SupervisorService } from './supervisor-service';
import { RoutingEngine } from './routing-engine';
import { DashboardService } from './dashboard';
import { AgentEventBus } from './agents/agent-event-bus';
import { AgentManager } from './agents/agent-manager';
import { AIRequest, OrchestratorConfig } from './types';

export class AIOrchestrator {
  public registry: ProviderRegistry;
  public providerManager: ProviderManager;
  public promptManager: PromptManager;
  public modelManager: ModelManager;
  public conversationManager: ConversationManager;
  public memory: AIMemory;
  public consensusEngine: ConsensusEngine;
  public fallbackEngine: FallbackEngine;
  public healthChecker: HealthChecker;
  public routingEngine: RoutingEngine;
  public dashboard: DashboardService;
  public supervisor: SupervisorService;
  public agentBus: AgentEventBus;
  public agentManager: AgentManager;

  constructor(config: OrchestratorConfig = {}) {
    this.registry = new ProviderRegistry();
    this.providerManager = new ProviderManager(this.registry, config.maxRetries ?? 2);
    this.promptManager = new PromptManager();
    this.modelManager = new ModelManager();
    this.conversationManager = new ConversationManager();
    this.memory = new AIMemory();
    this.consensusEngine = new ConsensusEngine();
    this.fallbackEngine = new FallbackEngine();
    this.healthChecker = new HealthChecker(this.registry);
    this.routingEngine = new RoutingEngine(
      this.registry,
      this.providerManager,
      this.promptManager,
      this.modelManager,
      this.conversationManager,
      this.memory,
      this.consensusEngine,
      this.fallbackEngine,
      this.healthChecker,
    );
    this.agentBus = new AgentEventBus();
    this.agentManager = new AgentManager(
      this.agentBus,
      this.memory,
      this.providerManager,
      this.promptManager,
      this.modelManager,
      this.conversationManager,
    );
    this.dashboard = new DashboardService(this.memory, this.registry);
    this.supervisor = new SupervisorService(this.registry, this.providerManager, this.dashboard, {
      serviceHealthChecks: config.serviceHealthChecks || {},
      workerRestarters: config.workerRestarters || {},
      alertHandler: config.alertHandler,
      providerFailureThreshold: config.providerFailureThreshold,
    });
  }

  async execute(request: AIRequest) {
    await this.healthChecker.runAll();
    return this.routingEngine.route(request);
  }

  async executeMultiAgent(request: AIRequest, metadata?: Record<string, any>) {
    await this.healthChecker.runAll();
    return this.agentManager.execute(request, metadata);
  }

  getDashboard() {
    return this.dashboard.getSummary();
  }

  async runSupervisor(): Promise<ReturnType<SupervisorService['runHealthChecks']>> {
    return this.supervisor.runHealthChecks();
  }

  async restartWorkers(): Promise<Record<string, boolean>> {
    return this.supervisor.attemptRestarts();
  }

  async switchProvider(from: OrchestratorProvider, to: OrchestratorProvider): Promise<boolean> {
    return this.supervisor.switchProvider(from, to);
  }

  getSupervisorReport() {
    return this.supervisor.getLastReport();
  }

  async getSupervisorArchitecturePlan() {
    return this.supervisor.getArchitecturePlan();
  }
}

export default AIOrchestrator;
