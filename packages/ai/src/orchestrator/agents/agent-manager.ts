import { AgentEventBus } from './agent-event-bus';
import { AIMemory } from '../ai-memory';
import { createAgents } from './agent-factory';
import type { AgentTask, SupervisorDecisionPayload } from './agent-types';
import type { ProviderManager } from '../provider-manager';
import type { PromptManager } from '../prompt-manager';
import type { ModelManager } from '../model-manager';
import type { ConversationManager } from '../conversation-manager';
import type { AIRequest } from '../types';

export class AgentManager {
  private readonly agents: any[];

  constructor(
    private readonly bus: AgentEventBus,
    private readonly memory: AIMemory,
    private readonly providerManager: ProviderManager,
    private readonly promptManager: PromptManager,
    private readonly modelManager: ModelManager,
    private readonly conversationManager: ConversationManager,
  ) {
    this.agents = createAgents(
      this.bus,
      this.memory,
      this.providerManager,
      this.promptManager,
      this.modelManager,
      this.conversationManager,
    );
  }

  async execute(request: AIRequest, metadata?: Record<string, any>) {
    const task: AgentTask = {
      taskId: `task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      request,
      metadata,
      createdAt: Date.now(),
    };

    return new Promise<SupervisorDecisionPayload>((resolve, reject) => {
      const unsubscribeDecision = this.bus.subscribe('supervisor:decision', (payload) => {
        if (payload.taskId !== task.taskId) {
          return;
        }

        unsubscribeDecision();
        unsubscribeError();
        resolve(payload);
      });

      const unsubscribeError = this.bus.subscribe('agent:error', (payload) => {
        if (payload.taskId !== task.taskId) {
          return;
        }

        // Keep the task running; preserve visibility for supervisor aggregation.
        if (this.shouldRejectOnCriticalError(payload)) {
          unsubscribeDecision();
          unsubscribeError();
          reject(new Error(`Agent failure: ${payload.agent} - ${payload.error}`));
        }
      });

      this.bus.publish('agent:task', task);
    });
  }

  private shouldRejectOnCriticalError(errorPayload: { error: string; agent: string }): boolean {
    return errorPayload.agent === 'supervisor';
  }
}
