import { AgentEventBus } from './agent-event-bus';
import type { AIMemory } from '../ai-memory';
import type { AgentResultPayload, AgentErrorPayload, SupervisorDecisionPayload, AgentTask, AgentName } from './agent-types';

export class SupervisorAgent {
  private readonly taskResults = new Map<string, AgentResultPayload[]>();
  private readonly taskErrors = new Map<string, AgentErrorPayload[]>();
  private readonly requiredAgents: AgentName[] = [
    'research',
    'technical-analysis',
    'fundamental-analysis',
    'news',
    'risk',
    'portfolio',
    'execution',
    'strategy',
    'market-scanner',
    'decision',
  ];

  constructor(private readonly bus: AgentEventBus, private readonly memory: AIMemory) {
    this.bus.subscribe('agent:result', this.onAgentResult.bind(this));
    this.bus.subscribe('agent:error', this.onAgentError.bind(this));
  }

  private onAgentResult(payload: AgentResultPayload) {
    const bucket = this.taskResults.get(payload.taskId) || [];
    bucket.push(payload);
    this.taskResults.set(payload.taskId, bucket);
    this.evaluateTask(payload.taskId);
  }

  private onAgentError(payload: AgentErrorPayload) {
    const bucket = this.taskErrors.get(payload.taskId) || [];
    bucket.push(payload);
    this.taskErrors.set(payload.taskId, bucket);
    this.evaluateTask(payload.taskId);
  }

  private evaluateTask(taskId: string) {
    const results = this.taskResults.get(taskId) || [];
    const errors = this.taskErrors.get(taskId) || [];
    const completedAgents = new Set(results.map((item) => item.agent));

    if (this.requiredAgents.every((agent) => completedAgents.has(agent))) {
      const decision = this.buildDecision(results, errors);
      const payload: SupervisorDecisionPayload = {
        taskId,
        decision: decision.recommendation,
        recommendationType: decision.recommendationType,
        rationale: decision.rationale,
        agentSummaries: results,
        timestamp: Date.now(),
      };

      this.bus.publish('supervisor:decision', payload);
      this.memory.remember({
        type: 'NOTE',
        title: `Supervisor decision for ${taskId}`,
        content: payload.rationale,
        metadata: {
          recommendation: payload.decision,
          recommendationType: payload.recommendationType,
          errors,
          agents: results.map((item) => item.agent),
        },
        conversationId: taskId,
      }).catch(() => undefined);
      this.taskResults.delete(taskId);
      this.taskErrors.delete(taskId);
    }
  }

  private buildDecision(results: AgentResultPayload[], errors: AgentErrorPayload[]) {
    const primaryDecision = results.find((item) => item.agent === 'decision');
    const guidance = results
      .filter((item) => item.agent !== 'decision')
      .map((item) => `${item.agent}: ${item.summary}`)
      .join(' \n');

    const recommendation = primaryDecision?.summary || this.generateDefaultRecommendation(results);
    const recommendationType = primaryDecision ? 'AI_DECISION' : 'CUSTOM_AGGREGATION';
    const rationale = [
      'Supervisor aggregation of agent outputs.',
      guidance,
      errors.length ? `Errors detected: ${errors.map((error) => `${error.agent} -> ${error.error}`).join('; ')}` : undefined,
    ]
      .filter(Boolean)
      .join('\n');

    return { recommendation, recommendationType, rationale };
  }

  private generateDefaultRecommendation(results: AgentResultPayload[]) {
    const score = results.reduce((sum, item) => sum + (item.score ?? 0), 0) / Math.max(results.length, 1);
    const trend = score > 0.6 ? 'BUY' : score < 0.4 ? 'SELL' : 'HOLD';
    return `${trend} based on aggregated intelligence of ${results.length} agents.`;
  }
}
