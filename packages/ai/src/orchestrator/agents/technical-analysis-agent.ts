import { AgentBase } from './agent-base';
import type { AgentTask, AgentResultPayload } from './agent-types';
import type { ProviderManager } from '../provider-manager';
import type { PromptManager } from '../prompt-manager';
import type { ModelManager } from '../model-manager';
import type { ConversationManager } from '../conversation-manager';
import type { AIMemory } from '../ai-memory';
import type { AIRequest } from '../types';
import { buildAgentPrompt, createAgentRequest } from './agent-utils';

export class TechnicalAnalysisAgent extends AgentBase {
  constructor(
    bus: any,
    memory: AIMemory,
    private providerManager: ProviderManager,
    private promptManager: PromptManager,
    private modelManager: ModelManager,
    private conversationManager: ConversationManager,
  ) {
    super('technical-analysis', bus, memory);
  }

  protected async process(task: AgentTask) {
    const symbol = task.request.metadata?.symbol || 'unknown';
    const prompt = buildAgentPrompt('Technical Analysis', symbol, 'technical analysis', 'Use chart patterns, momentum, support/resistance, and indicators.');
    const request: AIRequest = createAgentRequest(task, 'technical-analysis', prompt);
    const response = await this.providerManager.execute(request, this.providerManager.getBestProvider(request));

    const summary = `Technical analysis suggests ${response.content.slice(0, 120)}`;
    await this.persistMemory({
      type: 'NOTE',
      title: `Technical analysis ${symbol}`,
      content: response.content,
      metadata: { symbol, category: 'technical' },
    });

    return this.buildResult(task, summary, response);
  }

  private buildResult(task: AgentTask, summary: string, response: any): Omit<AgentResultPayload, 'agent' | 'timestamp'> {
    return {
      taskId: task.taskId,
      category: 'technical',
      summary,
      score: 0.8,
      data: {
        provider: response.provider,
        model: response.model,
        content: response.content,
      },
    };
  }
}
