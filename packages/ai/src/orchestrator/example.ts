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

async function run() {
  const registry = new ProviderRegistry();
  const providerManager = new ProviderManager(registry);
  const promptManager = new PromptManager();
  const modelManager = new ModelManager();
  const conversationManager = new ConversationManager();
  const memory = new AIMemory();
  const consensusEngine = new ConsensusEngine();
  const fallbackEngine = new FallbackEngine();
  const healthChecker = new HealthChecker(registry);
  const routingEngine = new RoutingEngine(
    registry,
    providerManager,
    promptManager,
    modelManager,
    conversationManager,
    memory,
    consensusEngine,
    fallbackEngine,
    healthChecker,
  );

  const request = {
    conversationId: 'demo-1',
    messages: [{ role: 'user' as const, content: 'Analyze BTC/USD trend and return a trading recommendation.' }],
    providerHint: 'openai' as const,
    requireConsensus: true,
    allowFallback: true,
    stream: false,
    mode: 'text' as const,
    metadata: { symbol: 'BTC/USD' },
  };

  await healthChecker.runAll();
  const result = await routingEngine.route(request);
  console.log(JSON.stringify(result, null, 2));

  const dashboard = new DashboardService(memory, registry);
  console.log(JSON.stringify(dashboard.getSummary(), null, 2));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
