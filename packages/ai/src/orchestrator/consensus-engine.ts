import { AIResponse, ConsensusResult } from './types';

export class ConsensusEngine {
  buildConsensus(responses: AIResponse[]): ConsensusResult {
    const same = responses.map((r) => r.content).filter((c, i, arr) => arr.indexOf(c) === i);
    const consensus = same[0] || responses[0]?.content || '';
    const averageConfidence = responses.reduce((sum, r) => sum + (r.confidence || 0), 0) / Math.max(1, responses.length);
    const agreementScore = responses.length > 1 ? 1 - (same.length - 1) / responses.length : 1;
    const winner = responses.sort((a, b) => b.confidence - a.confidence)[0]?.provider || 'openai';

    return {
      providerResponses: responses,
      consensus,
      confidence: Math.max(0, Math.min(1, averageConfidence)),
      agreementScore: Math.max(0, Math.min(1, agreementScore)),
      winner,
      reasons: [
        `Aggregated ${responses.length} provider responses`,
        `Agreement score: ${agreementScore.toFixed(2)}`,
      ],
      timestamp: Date.now(),
    };
  }
}

export default ConsensusEngine;
