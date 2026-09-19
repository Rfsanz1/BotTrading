import { AgentBase } from './agent-base';
import type { AgentTask, AgentResultPayload } from './agent-types';
import type { ProviderManager } from '../provider-manager';
import type { PromptManager } from '../prompt-manager';
import type { ModelManager } from '../model-manager';
import type { ConversationManager } from '../conversation-manager';
import type { AIMemory } from '../ai-memory';
import type { AIRequest } from '../types';
import { buildAgentPrompt, createAgentRequest } from './agent-utils';

export class DecisionAgent extends AgentBase {
  constructor(
    bus: any,
    memory: AIMemory,
    private providerManager: ProviderManager,
    private promptManager: PromptManager,
    private modelManager: ModelManager,
    private conversationManager: ConversationManager,
  ) {
    super('decision', bus, memory);
  }

  protected async process(task: AgentTask) {
    const symbol = task.request.metadata?.symbol || 'unknown';
    const prompt = buildAgentPrompt('Decision', symbol, 'final recommendation', 'Combine technical, fundamental, news, and risk views into one recommendation.');
    const request: AIRequest = createAgentRequest(task, 'decision', prompt);
    const response = await this.providerManager.execute(request, this.providerManager.getBestProvider(request));

    const summary = `Decision agent resolves ${response.content.slice(0, 120)}`;
    await this.persistMemory({
      type: 'NOTE',
      title: `Decision guidance ${symbol}`,
      content: response.content,
      metadata: { symbol, category: 'decision' },
    });

    return this.buildResult(task, summary, response);
  }

  private buildResult(task: AgentTask, summary: string, response: any): Omit<AgentResultPayload, 'agent' | 'timestamp'> {
    const recommendation = response.content.match(/BUY|SELL|HOLD/i)?.[0] || summary;
    return {
      taskId: task.taskId,
      category: 'decision',
      summary: recommendation,
      score: 0.75,
      data: {
        provider: response.provider,
        model: response.model,
        content: response.content,
      },
    };
  }
}
