import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { RecommendationGeneratedEvent, RecommendationApprovedEvent, RecommendationRejectedEvent } from '../../domain/events';
import { RecommendationNotFoundException, InvalidRecommendationStatusException } from '../../domain/exceptions';
import prisma from '@rfsanz/database/src/client';
import { IRecommendationGenerator } from '../../domain/interfaces';

@Injectable()
export class RecommendationService implements IRecommendationGenerator {
  private readonly logger = new Logger(RecommendationService.name);

  constructor(private readonly eventEmitter: EventEmitter2) {}

  /**
   * Generate recommendation from consensus
   */
  async generate(params: {
    alertId: string;
    userId: string;
    symbol: string;
    consensusRecommendation: 'BUY' | 'SELL' | 'HOLD';
    confidenceScore: number;
    riskScore: number;
    currentPrice: number;
    targetPrice?: number;
    stopLoss?: number;
  }): Promise<string> {
    try {
      this.logger.log(`Generating recommendation for ${params.symbol}`);

      // Calculate recommendation parameters
      const calculatedParams = this.calculateRecommendationParams(
        params.currentPrice,
        params.consensusRecommendation,
        params.riskScore,
      );

      const recommendation = await prisma.recommendation.create({
        data: {
          userId: params.userId,
          alertId: params.alertId,
          symbol: params.symbol,
          recommendationType: params.consensusRecommendation,
          entryPrice: params.currentPrice,
          targetPrice: params.targetPrice || calculatedParams.targetPrice,
          stopLoss: params.stopLoss || calculatedParams.stopLoss,
          riskReward: calculatedParams.riskReward,
          positionSizePercentage: calculatedParams.positionSizePercentage,
          urgency: this.calculateUrgency(params.confidenceScore),
          reasoning: this.generateReasoning(params),
          status: 'PENDING',
        },
      });

      // Link recommendation to consensus
      await prisma.consensus.update({
        where: { alertId: params.alertId },
        data: { recommendationId: recommendation.id },
      });

      // Publish event
      const event = new RecommendationGeneratedEvent(
        params.alertId,
        params.userId,
        recommendation.id,
        params.symbol,
        params.consensusRecommendation,
        params.currentPrice,
        recommendation.targetPrice as number,
        recommendation.stopLoss as number,
      );
      await this.eventEmitter.emitAsync('trading.recommendation.generated', event);

      this.logger.log(`Recommendation generated: ${recommendation.id} for ${params.symbol}`);

      return recommendation.id;
    } catch (error) {
      this.logger.error(`Failed to generate recommendation: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Approve recommendation
   */
  async approveRecommendation(recommendationId: string): Promise<void> {
    try {
      const recommendation = await prisma.recommendation.findUnique({
        where: { id: recommendationId },
      });

      if (!recommendation) {
        throw new RecommendationNotFoundException(recommendationId);
      }

      if (recommendation.status !== 'PENDING') {
        throw new InvalidRecommendationStatusException(recommendation.status);
      }

      await prisma.recommendation.update({
        where: { id: recommendationId },
        data: { status: 'APPROVED' },
      });

      // Publish event
      const event = new RecommendationApprovedEvent(
        recommendationId,
        recommendation.userId,
        recommendation.symbol,
      );
      await this.eventEmitter.emitAsync('trading.recommendation.approved', event);

      this.logger.log(`Recommendation approved: ${recommendationId}`);
    } catch (error) {
      this.logger.error(`Failed to approve recommendation: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Reject recommendation
   */
  async rejectRecommendation(recommendationId: string, reason?: string): Promise<void> {
    try {
      const recommendation = await prisma.recommendation.findUnique({
        where: { id: recommendationId },
      });

      if (!recommendation) {
        throw new RecommendationNotFoundException(recommendationId);
      }

      if (recommendation.status !== 'PENDING') {
        throw new InvalidRecommendationStatusException(recommendation.status);
      }

      await prisma.recommendation.update({
        where: { id: recommendationId },
        data: { status: 'REJECTED' },
      });

      // Publish event
      const event = new RecommendationRejectedEvent(
        recommendationId,
        recommendation.userId,
        recommendation.symbol,
        reason,
      );
      await this.eventEmitter.emitAsync('trading.recommendation.rejected', event);

      this.logger.log(`Recommendation rejected: ${recommendationId}`);
    } catch (error) {
      this.logger.error(`Failed to reject recommendation: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get recommendation by ID
   */
  async getRecommendation(recommendationId: string): Promise<any> {
    const recommendation = await prisma.recommendation.findUnique({
      where: { id: recommendationId },
    });

    if (!recommendation) {
      throw new RecommendationNotFoundException(recommendationId);
    }

    return recommendation;
  }

  /**
   * Get user's recommendations
   */
  async getUserRecommendations(userId: string, limit: number = 50): Promise<any[]> {
    return prisma.recommendation.findMany({
      where: { userId },
      take: limit,
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Calculate recommendation parameters
   */
  private calculateRecommendationParams(
    currentPrice: number,
    recommendation: string,
    riskScore: number,
  ): any {
    let targetPrice: number;
    let stopLoss: number;

    if (recommendation === 'BUY') {
      // For BUY: target is 3-5% above current price, stop is 2-3% below
      const riskAdjustment = 1 + riskScore * 0.02; // Adjust based on risk
      targetPrice = currentPrice * (1 + 0.04 * riskAdjustment);
      stopLoss = currentPrice * (1 - 0.025 * riskAdjustment);
    } else if (recommendation === 'SELL') {
      // For SELL: target is 3-5% below current price, stop is 2-3% above
      const riskAdjustment = 1 + riskScore * 0.02;
      targetPrice = currentPrice * (1 - 0.04 * riskAdjustment);
      stopLoss = currentPrice * (1 + 0.025 * riskAdjustment);
    } else {
      // For HOLD: no specific targets
      targetPrice = currentPrice;
      stopLoss = currentPrice * 0.95;
    }

    const riskReward = Math.abs((targetPrice - currentPrice) / (currentPrice - stopLoss));

    return {
      targetPrice: Math.round(targetPrice * 100000) / 100000,
      stopLoss: Math.round(stopLoss * 100000) / 100000,
      riskReward: Math.round(riskReward * 10000) / 10000,
      positionSizePercentage: Math.min(5, Math.max(0.5, 2 * (1 - riskScore))), // 0.5-5% based on risk
    };
  }

  /**
   * Calculate urgency based on confidence score
   */
  private calculateUrgency(confidenceScore: number): string {
    if (confidenceScore >= 0.75) return 'HIGH';
    if (confidenceScore >= 0.5) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Generate reasoning for recommendation
   */
  private generateReasoning(params: any): string {
    return `Based on analysis from multiple AI providers (confidence: ${Math.round(params.confidenceScore * 100)}%), the market shows a ${params.consensusRecommendation} signal with ${params.riskScore > 0.6 ? 'high' : 'manageable'} risk levels. The recommendation includes entry at current price with target at profit level and stop loss for risk management.`;
  }
}
