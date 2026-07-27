import { AgentBase } from './agent-base';
import type { AgentTask, AgentResultPayload } from './agent-types';
import type { ProviderManager } from '../provider-manager';
import type { PromptManager } from '../prompt-manager';
import type { ModelManager } from '../model-manager';
import type { ConversationManager } from '../conversation-manager';
import type { AIMemory } from '../ai-memory';
import type { AIRequest } from '../types';
import { buildAgentPrompt, createAgentRequest } from './agent-utils';

export class ResearchAgent extends AgentBase {
  constructor(
    bus: any,
    memory: AIMemory,
    private providerManager: ProviderManager,
    private promptManager: PromptManager,
    private modelManager: ModelManager,
    private conversationManager: ConversationManager,
  ) {
    super('research', bus, memory);
  }

  protected async process(task: AgentTask) {
    const symbol = task.request.metadata?.symbol || 'unknown';
    const prompt = buildAgentPrompt('Research', symbol, 'broader research', 'Include macro events, market catalysts, and prior performance.');
    const request: AIRequest = createAgentRequest(task, 'research', prompt);
    const response = await this.providerManager.execute(request, this.providerManager.getBestProvider(request));

    const summary = `Research agent found ${response.content.slice(0, 120)}`;
    await this.persistMemory({
      type: 'NOTE',
      title: `Research ${symbol}`,
      content: response.content,
      metadata: { symbol, category: 'research' },
    });

    return this.buildResult(task, summary, response);
  }

  private buildResult(task: AgentTask, summary: string, response: any): Omit<AgentResultPayload, 'agent' | 'timestamp'> {
    return {
      taskId: task.taskId,
      category: 'research',
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
