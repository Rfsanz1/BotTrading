import { AgentBase } from './agent-base';
import type { AgentTask, AgentResultPayload } from './agent-types';
import type { ProviderManager } from '../provider-manager';
import type { PromptManager } from '../prompt-manager';
import type { ModelManager } from '../model-manager';
import type { ConversationManager } from '../conversation-manager';
import type { AIMemory } from '../ai-memory';
import type { AIRequest } from '../types';
import { buildAgentPrompt, createAgentRequest } from './agent-utils';

export class NewsAgent extends AgentBase {
  constructor(
    bus: any,
    memory: AIMemory,
    private providerManager: ProviderManager,
    private promptManager: PromptManager,
    private modelManager: ModelManager,
    private conversationManager: ConversationManager,
  ) {
    super('news', bus, memory);
  }

  protected async process(task: AgentTask) {
    const symbol = task.request.metadata?.symbol || 'unknown';
    const prompt = buildAgentPrompt('News', symbol, 'latest headlines and sentiment', 'Summarize recent news, announcements, and sentiment related to the market or asset.');
    const request: AIRequest = createAgentRequest(task, 'news', prompt);
    const response = await this.providerManager.execute(request, this.providerManager.getBestProvider(request));

    const summary = `News agent captured ${response.content.slice(0, 120)}`;
    await this.persistMemory({
      type: 'NOTE',
      title: `News summary ${symbol}`,
      content: response.content,
      metadata: { symbol, category: 'news' },
    });

    return this.buildResult(task, summary, response);
  }

  private buildResult(task: AgentTask, summary: string, response: any): Omit<AgentResultPayload, 'agent' | 'timestamp'> {
    return {
      taskId: task.taskId,
      category: 'news',
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
