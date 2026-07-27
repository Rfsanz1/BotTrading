import { ProviderRegistry } from './provider-registry';
import { ProviderManager } from './provider-manager';
import { PromptManager } from './prompt-manager';
import { ModelManager } from './model-manager';
import { ConversationManager } from './conversation-manager';
import { AIMemory } from './ai-memory';
import { ConsensusEngine } from './consensus-engine';
import { FallbackEngine } from './fallback-engine';
import { HealthChecker } from './health-checker';
import { RoutingEngine } from './routing-engine';
import { DashboardService } from './dashboard';
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
    this.dashboard = new DashboardService(this.memory, this.registry);
  }

  async execute(request: AIRequest) {
    await this.healthChecker.runAll();
    return this.routingEngine.route(request);
  }

  getDashboard() {
    return this.dashboard.getSummary();
  }
}

export default AIOrchestrator;
