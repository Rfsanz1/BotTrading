import type { AIRequest } from '../types';

export type AgentName =
  | 'research'
  | 'technical-analysis'
  | 'fundamental-analysis'
  | 'news'
  | 'risk'
  | 'portfolio'
  | 'execution'
  | 'strategy'
  | 'market-scanner'
  | 'decision'
  | 'supervisor';

export type AgentCategory =
  | 'research'
  | 'technical'
  | 'fundamental'
  | 'news'
  | 'risk'
  | 'portfolio'
  | 'execution'
  | 'strategy'
  | 'market'
  | 'decision'
  | 'supervisor';

export interface AgentTask {
  taskId: string;
  request: AIRequest;
  metadata?: Record<string, any>;
  createdAt: number;
}

export interface AgentResultPayload {
  taskId: string;
  agent: AgentName;
  category: AgentCategory;
  summary: string;
  score?: number;
  data: Record<string, any>;
  timestamp: number;
}

export interface AgentErrorPayload {
  taskId: string;
  agent: AgentName;
  error: string;
  details?: any;
  timestamp: number;
}

export interface AgentStatusPayload {
  taskId: string;
  agent: AgentName;
  status: 'started' | 'completed' | 'failed';
  message?: string;
  timestamp: number;
}

export interface SupervisorDecisionPayload {
  taskId: string;
  decision: string;
  recommendationType: string;
  rationale: string;
  agentSummaries: AgentResultPayload[];
  timestamp: number;
}

export interface AgentEvents {
  'agent:task': AgentTask;
  'agent:result': AgentResultPayload;
  'agent:error': AgentErrorPayload;
  'agent:status': AgentStatusPayload;
  'supervisor:decision': SupervisorDecisionPayload;
}
