import { AIMemory, MemoryEvent } from '../ai-memory';
import { AgentEventBus } from './agent-event-bus';
import type { AgentName, AgentTask, AgentResultPayload, AgentStatusPayload } from './agent-types';

export abstract class AgentBase {
  constructor(public readonly name: AgentName, protected readonly bus: AgentEventBus, protected readonly memory: AIMemory) {
    this.bus.subscribe('agent:task', this.onTask.bind(this));
  }

  protected shouldProcess(task: AgentTask) {
    return true;
  }

  protected abstract process(task: AgentTask): Promise<Omit<AgentResultPayload, 'agent' | 'timestamp'>>;

  private async onTask(task: AgentTask) {
    if (!this.shouldProcess(task)) {
      return;
    }

    this.publishStatus(task, 'started');
    try {
      const result = await this.process(task);
      this.publishResult({ ...result, taskId: task.taskId });
      this.publishStatus(task, 'completed');
    } catch (error) {
      this.publishError(task, error as Error);
    }
  }

  protected publishResult(payload: Omit<AgentResultPayload, 'agent' | 'timestamp'>) {
    this.bus.publish('agent:result', {
      ...payload,
      agent: this.name,
      timestamp: Date.now(),
    });
  }

  protected publishError(task: AgentTask, error: Error | string, details?: any) {
    this.bus.publish('agent:error', {
      taskId: task.taskId,
      agent: this.name,
      error: error instanceof Error ? error.message : String(error),
      details,
      timestamp: Date.now(),
    });
    this.publishStatus(task, 'failed', error instanceof Error ? error.message : String(error));
  }

  protected publishStatus(task: AgentTask, status: 'started' | 'completed' | 'failed', message?: string) {
    const statusPayload: AgentStatusPayload = {
      taskId: task.taskId,
      agent: this.name,
      status,
      message,
      timestamp: Date.now(),
    };

    this.bus.publish('agent:status', statusPayload);
  }

  protected async persistMemory(entry: Omit<MemoryEvent, 'createdAt' | 'source'>) {
    await this.memory.remember({
      ...entry,
      source: this.name,
      createdAt: Date.now(),
    });
  }
}
