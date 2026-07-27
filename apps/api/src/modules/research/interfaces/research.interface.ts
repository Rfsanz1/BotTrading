export interface ResearchSourcePayload {
  source: string;
  category: string;
  score: number;
  confidence: number;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface ResearchResult {
  id?: string;
  symbol: string;
  timeframe: string;
  exchange: string;
  sources: ResearchSourcePayload[];
  technical: Record<string, unknown>;
  fundamental: Record<string, unknown>;
  sentiment: Record<string, unknown>;
  onChain: Record<string, unknown>;
  liquidity: Record<string, unknown>;
  volume: Record<string, unknown>;
  volatility: Record<string, unknown>;
  correlation: Record<string, unknown>;
  researchScore: number;
  researchConfidence: number;
  createdAt?: Date;
  updatedAt?: Date;
}

export interface ResearchJob {
  id: string;
  symbol: string;
  timeframe: string;
  exchange: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  createdAt: Date;
  updatedAt: Date;
  result?: ResearchResult;
}
