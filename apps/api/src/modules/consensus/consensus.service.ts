import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ConsensusBuiltEvent } from '../../domain/events';
import { ConsensusFailedException } from '../../domain/exceptions';
import prisma from '@rfsanz/database/src/client';
import { IConsensusBuilder } from '../../domain/interfaces';

@Injectable()
export class ConsensusService implements IConsensusBuilder {
  private readonly logger = new Logger(ConsensusService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Build consensus from AI analyses
   */
  async buildConsensus(alertId: string, userId: string, symbol: string, analyses: any[]): Promise<any> {
    try {
      if (analyses.length === 0) {
        throw new ConsensusFailedException('No analyses provided for consensus building');
      }

      this.logger.log(`Building consensus from ${analyses.length} AI analyses for ${symbol}`);

      // Calculate votes
      const votes = this.calculateVotes(analyses);
      const recommendation = this.getRecommendation(votes);
      const confidenceScore = this.calculateConfidenceScore(analyses);
      const riskScore = this.calculateRiskScore(analyses);

      // Save consensus to database
      const consensus = await prisma.consensus.create({
        data: {
          alertId,
          symbol,
          recommendation,
          confidenceScore,
          riskScore,
          bulletPoints: this.generateBulletPoints(analyses),
          analysis: this.generateAnalysisSummary(analyses, recommendation),
          providerVotes: votes as any,
        },
      });

      // Publish event
      const event = new ConsensusBuiltEvent(
        alertId,
        userId,
        symbol,
        recommendation,
        Number(confidenceScore),
        Number(riskScore),
        votes,
      );
      await this.eventEmitter.emitAsync('trading.consensus.built', event);

      this.logger.log(`Consensus built: ${recommendation} with confidence ${confidenceScore} for ${symbol}`);

      return consensus;
    } catch (error) {
      this.logger.error(`Failed to build consensus: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Calculate provider votes
   */
  private calculateVotes(analyses: any[]): Record<string, string> {
    const votes: Record<string, string> = {};

    for (const analysis of analyses) {
      votes[analysis.provider] = analysis.recommendation;
    }

    return votes;
  }

  /**
   * Get final recommendation based on votes
   */
  private getRecommendation(votes: Record<string, string>): 'BUY' | 'SELL' | 'HOLD' {
    const counts = { BUY: 0, SELL: 0, HOLD: 0 };

    for (const vote of Object.values(votes)) {
      if (vote === 'BUY' || vote === 'SELL' || vote === 'HOLD') {
        counts[vote]++;
      }
    }

    // If BUY and SELL are equal, default to HOLD
    if (counts.BUY === counts.SELL) {
      return 'HOLD';
    }

    // Return the most common recommendation
    const max = Math.max(counts.BUY, counts.SELL, counts.HOLD);
    if (counts.BUY === max) return 'BUY';
    if (counts.SELL === max) return 'SELL';
    return 'HOLD';
  }

  /**
   * Calculate confidence score based on agreement
   */
  private calculateConfidenceScore(analyses: any[]): number {
    if (analyses.length === 0) return 0;

    // Average confidence from all providers
    const avgConfidence = analyses.reduce((sum: number, a: any) => sum + Number(a.confidence), 0) / analyses.length;

    // Calculate agreement bonus
    const votes = this.calculateVotes(analyses);
    const recommendations = Object.values(votes) as string[];
    const topVote = this.getRecommendation(votes);
    const agreement = recommendations.filter(r => r === topVote).length / recommendations.length;

    // Combine average confidence with agreement factor
    const combinedScore = (avgConfidence * 0.6 + agreement * 0.4);

    return Math.round(combinedScore * 10000) / 10000; // Round to 4 decimals
  }

  /**
   * Calculate risk score based on provider assessments
   */
  private calculateRiskScore(analyses: any[]): number {
    const riskMap = { HIGH: 0.8, MEDIUM: 0.5, LOW: 0.2 };
    
    const avgRisk = analyses.reduce((sum: number, a: any) => {
      const riskValue = riskMap[a.riskLevel as keyof typeof riskMap] || 0.5;
      return sum + riskValue;
    }, 0) / analyses.length;

    return Math.round(avgRisk * 10000) / 10000;
  }

  /**
   * Generate bullet points summary
   */
  private generateBulletPoints(analyses: any[]): string[] {
    const points: string[] = [];

    // Add top key points from analyses
    for (const analysis of analyses.slice(0, 3)) {
      if (analysis.keyPoints && analysis.keyPoints.length > 0) {
        points.push(`${analysis.provider}: ${analysis.keyPoints[0]}`);
      }
    }

    return points;
  }

  /**
   * Generate analysis summary
   */
  private generateAnalysisSummary(analyses: any[], recommendation: string): string {
    const providers = analyses.map(a => a.provider).join(', ');
    return `Consensus from ${providers}: ${recommendation}. All providers agree on this direction based on technical and fundamental analysis.`;
  }

  /**
   * Get consensus for alert
   */
  async getConsensus(alertId: string): Promise<any> {
    return prisma.consensus.findUnique({
      where: { alertId },
    });
  }
}
