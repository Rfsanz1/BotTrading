import { AgentBase } from './agent-base';
import type { AgentTask, AgentResultPayload } from './agent-types';
import type { ProviderManager } from '../provider-manager';
import type { PromptManager } from '../prompt-manager';
import type { ModelManager } from '../model-manager';
import type { ConversationManager } from '../conversation-manager';
import type { AIMemory } from '../ai-memory';
import type { AIRequest } from '../types';
import { buildAgentPrompt, createAgentRequest } from './agent-utils';

export class StrategyAgent extends AgentBase {
  constructor(
    bus: any,
    memory: AIMemory,
    private providerManager: ProviderManager,
    private promptManager: PromptManager,
    private modelManager: ModelManager,
    private conversationManager: ConversationManager,
  ) {
    super('strategy', bus, memory);
  }

  protected async process(task: AgentTask) {
    const symbol = task.request.metadata?.symbol || 'unknown';
    const prompt = buildAgentPrompt('Strategy', symbol, 'strategy recommendations', 'Identify a tactical strategy and alignment with current conditions.');
    const request: AIRequest = createAgentRequest(task, 'strategy', prompt);
    const response = await this.providerManager.execute(request, this.providerManager.getBestProvider(request));

    const summary = `Strategy agent recommended ${response.content.slice(0, 120)}`;
    await this.persistMemory({
      type: 'NOTE',
      title: `Strategy recommendation ${symbol}`,
      content: response.content,
      metadata: { symbol, category: 'strategy' },
    });

    return this.buildResult(task, summary, response);
  }

  private buildResult(task: AgentTask, summary: string, response: any): Omit<AgentResultPayload, 'agent' | 'timestamp'> {
    return {
      taskId: task.taskId,
      category: 'strategy',
      summary,
      score: 0.7,
      data: {
        provider: response.provider,
        model: response.model,
        content: response.content,
      },
    };
  }
}
