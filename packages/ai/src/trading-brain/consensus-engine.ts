/**
 * Consensus Engine and Confidence Scoring
 * Combines multiple AI providers and analysis sources into unified recommendation
 */

import { TradeRecommendation, ConsensusDetails, AnalysisSource } from './types';

export interface ProviderAnalysis {
  provider: string;
  recommendation: string; // 'BUY' | 'SELL' | 'HOLD'
  confidence: number; // 0-1
  reasoning: string;
  score: number; // -1 to 1 (sell to buy)
}

export interface AnalysisAggregation {
  technical: { confidence: number; signals: string[] } | null;
  sentiment: { confidence: number; signals: string[] } | null;
  volume: { confidence: number; signals: string[] } | null;
  liquidity: { confidence: number; signals: string[] } | null;
  orderFlow: { confidence: number; signals: string[] } | null;
  structure: { confidence: number; signals: string[] } | null;
  risk: { confidence: number; signals: string[] } | null;
}

export class ConsensusEngine {
  /**
   * Aggregate multiple provider recommendations into a single consensus
   */
  aggregateProviders(analyses: ProviderAnalysis[]): {
    recommendation: string;
    confidence: number;
    agreementScore: number;
    details: ConsensusDetails;
  } {
    if (analyses.length === 0) {
      return {
        recommendation: 'HOLD',
        confidence: 0,
        agreementScore: 0,
        details: { providers: [], aggregationMethod: 'empty', agreementScore: 0 },
      };
    }

    // Convert recommendations to scores
    const scores = analyses.map((a) => this.recommendationToScore(a.recommendation) * a.confidence);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;

    // Calculate agreement score (how much providers agree)
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);
    const scoreRange = maxScore - minScore;
    const agreementScore = Math.max(0, 1 - scoreRange / 2); // 0 if range is >2

    // Determine overall recommendation
    let recommendation: string;
    if (avgScore > 0.3) recommendation = 'BUY';
    else if (avgScore < -0.3) recommendation = 'SELL';
    else recommendation = 'HOLD';

    // Confidence is combination of average confidence and agreement
    const avgConfidence = analyses.reduce((a, b) => a + b.confidence, 0) / analyses.length;
    const confidence = (avgConfidence + agreementScore) / 2;

    // Identify dissent
    const buyCount = analyses.filter((a) => a.recommendation === 'BUY').length;
    const sellCount = analyses.filter((a) => a.recommendation === 'SELL').length;
    const holdCount = analyses.filter((a) => a.recommendation === 'HOLD').length;
    const dissent: string[] = [];
    if (buyCount > 0 && (sellCount > 0 || holdCount > 0) && recommendation !== 'BUY') {
      dissent.push(`${buyCount} providers recommended BUY`);
    }
    if (sellCount > 0 && (buyCount > 0 || holdCount > 0) && recommendation !== 'SELL') {
      dissent.push(`${sellCount} providers recommended SELL`);
    }

    return {
      recommendation,
      confidence: Math.max(0, Math.min(1, confidence)),
      agreementScore,
      details: {
        providers: analyses.map((a) => ({
          name: a.provider,
          recommendation: a.recommendation,
          confidence: a.confidence,
          reasoning: a.reasoning,
        })),
        aggregationMethod: 'weighted-score-average',
        agreementScore,
        dissent: dissent.length > 0 ? dissent : undefined,
      },
    };
  }

  /**
   * Generate analysis score from multiple data sources
   */
  aggregateAnalyses(analyses: AnalysisAggregation): {
    overallScore: number;
    confidence: number;
    sources: AnalysisSource[];
    keyFactors: string[];
  } {
    const sources: AnalysisSource[] = [];
    const factors: string[] = [];
    const scores: number[] = [];
    const confidences: number[] = [];

    // Technical
    if (analyses.technical) {
      sources.push({
        type: 'technical',
        name: 'Technical Analysis',
        confidence: analyses.technical.confidence,
        signals: analyses.technical.signals,
      });
      scores.push(analyses.technical.confidence);
      confidences.push(analyses.technical.confidence);
      factors.push(...analyses.technical.signals);
    }

    // Sentiment
    if (analyses.sentiment) {
      sources.push({
        type: 'sentiment',
        name: 'News Sentiment',
        confidence: analyses.sentiment.confidence,
        signals: analyses.sentiment.signals,
      });
      scores.push(analyses.sentiment.confidence);
      confidences.push(analyses.sentiment.confidence);
      factors.push(...analyses.sentiment.signals);
    }

    // Volume
    if (analyses.volume) {
      sources.push({
        type: 'volume',
        name: 'Volume Analysis',
        confidence: analyses.volume.confidence,
        signals: analyses.volume.signals,
      });
      scores.push(analyses.volume.confidence * 0.5); // Weight volume less
      confidences.push(analyses.volume.confidence);
      factors.push(...analyses.volume.signals);
    }

    // Liquidity
    if (analyses.liquidity) {
      sources.push({
        type: 'volume', // Grouped with volume
        name: 'Liquidity',
        confidence: analyses.liquidity.confidence,
        signals: analyses.liquidity.signals,
      });
      factors.push(...analyses.liquidity.signals);
    }

    // Order Flow
    if (analyses.orderFlow) {
      sources.push({
        type: 'order_flow',
        name: 'Order Flow',
        confidence: analyses.orderFlow.confidence,
        signals: analyses.orderFlow.signals,
      });
      scores.push(analyses.orderFlow.confidence * 0.7);
      confidences.push(analyses.orderFlow.confidence);
      factors.push(...analyses.orderFlow.signals);
    }

    // Market Structure
    if (analyses.structure) {
      sources.push({
        type: 'fundamental',
        name: 'Market Structure',
        confidence: analyses.structure.confidence,
        signals: analyses.structure.signals,
      });
      scores.push(analyses.structure.confidence);
      confidences.push(analyses.structure.confidence);
      factors.push(...analyses.structure.signals);
    }

    // Risk (negative weight - reduces confidence if high risk)
    if (analyses.risk) {
      scores.push(-analyses.risk.confidence * 0.5); // Penalize for risk
      factors.push(...analyses.risk.signals);
    }

    const overallScore =
      scores.length > 0 ? Math.max(-1, Math.min(1, scores.reduce((a, b) => a + b, 0) / scores.length)) : 0;
    const confidence = confidences.length > 0 ? confidences.reduce((a, b) => a + b, 0) / confidences.length : 0;

    return {
      overallScore,
      confidence: Math.max(0, Math.min(1, confidence)),
      sources,
      keyFactors: [...new Set(factors)].slice(0, 5), // Top 5 unique factors
    };
  }

  private recommendationToScore(recommendation: string): number {
    switch (recommendation.toUpperCase()) {
      case 'BUY':
        return 1;
      case 'SELL':
        return -1;
      case 'HOLD':
      default:
        return 0;
    }
  }
}

export class ConfidenceScorer {
  /**
   * Generate confidence score based on multiple factors
   */
  calculateConfidence(factors: ConfidenceFactor[]): { score: number; explanation: string[] } {
    const explanation: string[] = [];
    let baseScore = 0.5; // Start neutral

    // Weight each factor
    const weights: Record<string, number> = {
      agreement: 0.3, // Provider agreement
      analysis_count: 0.2, // Number of analyses performed
      signal_strength: 0.25, // Strength of signals
      risk_level: 0.1, // Lower confidence if high risk
      historical_accuracy: 0.15, // Learning history
    };

    for (const factor of factors) {
      const weight = weights[factor.type] || 0.1;
      const contribution = factor.value * weight;
      baseScore += contribution;

      if (contribution > 0.05) {
        explanation.push(`${factor.name}: +${(contribution * 100).toFixed(1)}%`);
      } else if (contribution < -0.05) {
        explanation.push(`${factor.name}: ${(contribution * 100).toFixed(1)}%`);
      }
    }

    const finalScore = Math.max(0, Math.min(1, baseScore));

    return {
      score: finalScore,
      explanation,
    };
  }

  /**
   * Adjust confidence based on historical performance
   */
  adjustForHistoricalAccuracy(baseConfidence: number, winRate: number, profitFactor: number): number {
    if (winRate === 0 || profitFactor === 0) return baseConfidence;

    // Positive factor if good historical performance
    const accuracyBoost = (winRate - 0.5) * 0.2 + Math.max(0, profitFactor - 1) * 0.1;
    return Math.max(0, Math.min(1, baseConfidence + accuracyBoost));
  }

  /**
   * Reduce confidence based on risk factors
   */
  adjustForRisk(baseConfidence: number, riskLevel: 'low' | 'medium' | 'high', concentration: number): number {
    let adjustment = 0;

    // Risk level adjustment
    if (riskLevel === 'high') {
      adjustment -= 0.2;
    } else if (riskLevel === 'medium') {
      adjustment -= 0.1;
    }

    // Concentration adjustment
    if (concentration > 0.25) {
      adjustment -= 0.15;
    }

    return Math.max(0, Math.min(1, baseConfidence + adjustment));
  }
}

export interface ConfidenceFactor {
  type: string;
  name: string;
  value: number; // -1 to 1
}
