import type { ProviderManager } from '../provider-manager';
import type { PromptManager } from '../prompt-manager';
import type { ModelManager } from '../model-manager';
import type { ConversationManager } from '../conversation-manager';
import { AgentEventBus } from './agent-event-bus';
import { AIMemory } from '../ai-memory';
import { ResearchAgent } from './research-agent';
import { TechnicalAnalysisAgent } from './technical-analysis-agent';
import { FundamentalAnalysisAgent } from './fundamental-analysis-agent';
import { NewsAgent } from './news-agent';
import { RiskAgent } from './risk-agent';
import { PortfolioAgent } from './portfolio-agent';
import { ExecutionAgent } from './execution-agent';
import { StrategyAgent } from './strategy-agent';
import { MarketScannerAgent } from './market-scanner-agent';
import { DecisionAgent } from './decision-agent';
import { SupervisorAgent } from './supervisor-agent';

export function createAgents(
  bus: AgentEventBus,
  memory: AIMemory,
  providerManager: ProviderManager,
  promptManager: PromptManager,
  modelManager: ModelManager,
  conversationManager: ConversationManager,
) {
  return [
    new ResearchAgent(bus, memory, providerManager, promptManager, modelManager, conversationManager),
    new TechnicalAnalysisAgent(bus, memory, providerManager, promptManager, modelManager, conversationManager),
    new FundamentalAnalysisAgent(bus, memory, providerManager, promptManager, modelManager, conversationManager),
    new NewsAgent(bus, memory, providerManager, promptManager, modelManager, conversationManager),
    new RiskAgent(bus, memory, providerManager, promptManager, modelManager, conversationManager),
    new PortfolioAgent(bus, memory, providerManager, promptManager, modelManager, conversationManager),
    new ExecutionAgent(bus, memory, providerManager, promptManager, modelManager, conversationManager),
    new StrategyAgent(bus, memory, providerManager, promptManager, modelManager, conversationManager),
    new MarketScannerAgent(bus, memory, providerManager, promptManager, modelManager, conversationManager),
    new DecisionAgent(bus, memory, providerManager, promptManager, modelManager, conversationManager),
    new SupervisorAgent(bus, memory),
  ];
}
