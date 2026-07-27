import { AgentBase } from './agent-base';
import type { AgentTask, AgentResultPayload } from './agent-types';
import type { ProviderManager } from '../provider-manager';
import type { PromptManager } from '../prompt-manager';
import type { ModelManager } from '../model-manager';
import type { ConversationManager } from '../conversation-manager';
import type { AIMemory } from '../ai-memory';
import type { AIRequest } from '../types';
import { buildAgentPrompt, createAgentRequest } from './agent-utils';

export class PortfolioAgent extends AgentBase {
  constructor(
    bus: any,
    memory: AIMemory,
    private providerManager: ProviderManager,
    private promptManager: PromptManager,
    private modelManager: ModelManager,
    private conversationManager: ConversationManager,
  ) {
    super('portfolio', bus, memory);
  }

  protected async process(task: AgentTask) {
    const symbol = task.request.metadata?.symbol || 'unknown';
    const portfolioContext = task.request.metadata?.portfolio || 'general';
    const prompt = buildAgentPrompt('Portfolio', symbol, 'portfolio position sizing', `Judge this symbol relative to the portfolio context: ${portfolioContext}.`);
    const request: AIRequest = createAgentRequest(task, 'portfolio', prompt);
    const response = await this.providerManager.execute(request, this.providerManager.getBestProvider(request));

    const summary = `Portfolio agent suggests ${response.content.slice(0, 120)}`;
    await this.persistMemory({
      type: 'NOTE',
      title: `Portfolio guidance ${symbol}`,
      content: response.content,
      metadata: { symbol, category: 'portfolio', portfolioContext },
    });

    return this.buildResult(task, summary, response);
  }

  private buildResult(task: AgentTask, summary: string, response: any): Omit<AgentResultPayload, 'agent' | 'timestamp'> {
    return {
      taskId: task.taskId,
      category: 'portfolio',
      summary,
      score: 0.72,
      data: {
        provider: response.provider,
        model: response.model,
        content: response.content,
      },
    };
  }
}
