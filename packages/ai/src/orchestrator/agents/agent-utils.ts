import type { AIRequest } from '../types';
import type { AgentTask } from './agent-types';

export function buildAgentPrompt(agentName: string, symbol: string, focus: string, context?: string) {
  const base = `You are the ${agentName} agent. Analyze ${symbol} with a ${focus} focus.`;
  if (context) {
    return `${base} ${context}`;
  }
  return base;
}

export function createAgentRequest(task: AgentTask, agentName: string, prompt: string): AIRequest {
  return {
    conversationId: `${task.taskId}-${agentName}`,
    messages: [{ role: 'system', content: prompt }, ...task.request.messages],
    providerHint: task.request.providerHint,
    requireConsensus: false,
    allowFallback: true,
    stream: false,
    mode: 'text',
    metadata: {
      ...task.request.metadata,
      agent: agentName,
      taskId: task.taskId,
    },
  };
}
