/**
 * Trading Brain Service - Production Database Integration
 * High-level API for trading brain with Prisma database
 */

import { PrismaClient } from '@prisma/client';
import { AITradingBrain } from './trading-brain';
import {
  TradingBrainInput,
  TradingBrainOutput,
  TradeRecommendation,
  TradeHistory,
  LearningRecord,
} from './types';

export class TradingBrainService {
  private brain: AITradingBrain;
  private db: PrismaClient;

  constructor(db: PrismaClient, brainConfig?: any) {
    this.db = db;
    this.brain = new AITradingBrain(brainConfig);
  }

  /**
   * Analyze market and generate recommendation
   */
  async analyze(input: TradingBrainInput, userId: string): Promise<TradingBrainOutput> {
    // Run brain analysis
    const output = await this.brain.analyzeMarket(input);

    // Store analysis in database
    await this.storeAnalysis(output, userId);

    return output;
  }

  /**
   * Store analysis results in database
   */
  private async storeAnalysis(output: TradingBrainOutput, userId: string): Promise<void> {
    const rec = output.recommendation;

    try {
      // Create or update consensus
      const consensus = await this.db.consensus.upsert({
        where: { id: rec.id },
        update: {
          recommendation: rec.action === 'BUY' ? 'BUY' : rec.action === 'SELL' ? 'SELL' : 'HOLD',
          confidenceScore: rec.confidence,
          riskScore: rec.risks.reduce((sum, r) => sum + (r.level === 'high' ? 1 : r.level === 'medium' ? 0.5 : 0), 0) / Math.max(1, rec.risks.length),
          bulletPoints: rec.explanations.map((e) => e.explanation),
          analysis: rec.reasoning,
          providerVotes: rec.consensusDetails
            ? Object.fromEntries(
              rec.consensusDetails.providers.map((p) => [
                p.name.toUpperCase().replace(/\s+/g, '_'),
                p.recommendation,
              ]),
            )
            : {},
        },
        create: {
          symbol: rec.symbol,
          recommendation: rec.action === 'BUY' ? 'BUY' : rec.action === 'SELL' ? 'SELL' : 'HOLD',
          confidenceScore: rec.confidence,
          riskScore: rec.risks.reduce((sum, r) => sum + (r.level === 'high' ? 1 : r.level === 'medium' ? 0.5 : 0), 0) / Math.max(1, rec.risks.length),
          bulletPoints: rec.explanations.map((e) => e.explanation),
          analysis: rec.reasoning,
          providerVotes: rec.consensusDetails
            ? Object.fromEntries(
              rec.consensusDetails.providers.map((p) => [
                p.name.toUpperCase().replace(/\s+/g, '_'),
                p.recommendation,
              ]),
            )
            : {},
          alertId: 'system-generated',
        },
      });

      // Store individual analysis results
      for (const source of rec.sources) {
        await this.db.analysis.create({
          data: {
            symbol: rec.symbol,
            provider: 'AI_BRAIN' as any,
            analysis: source.signals.join('; '),
            confidence: source.confidence,
            riskLevel: rec.risks[0]?.level || 'MEDIUM',
            sentiment: source.name.includes('Sentiment') ? 'BULLISH' : undefined,
            keyPoints: source.signals,
            alertId: 'system-generated',
          },
        });
      }
    } catch (error) {
      console.error('Error storing analysis:', error);
      // Don't fail the whole operation if storage fails
    }
  }

  /**
   * Execute recommendation and record trade
   */
  async executeRecommendation(
    recommendation: TradeRecommendation,
    userId: string,
    executedPrice: number,
    executedSize: number,
  ): Promise<void> {
    // Create trade record
    const tradeRecord = await this.db.tradeRecord.create({
      data: {
        userId,
        symbol: recommendation.symbol,
        executedAction: recommendation.action,
        executedPrice,
        executedSize,
        entryPrice: recommendation.entryPrice ? parseFloat(recommendation.entryPrice.toString()) : null,
        outcome: 'pending',
        recommendationId: recommendation.id,
      },
    });

    // Update recommendation status
    await this.db.recommendation.update({
      where: { id: recommendation.id },
      data: { status: 'EXECUTED' },
    });
  }

  /**
   * Record trade result
   */
  async recordTradeResult(
    tradeRecordId: string,
    exitPrice: number,
    exitReason: string,
    pnl: number,
    pnlPercentage: number,
  ): Promise<void> {
    const tradeRecord = await this.db.tradeRecord.findUnique({
      where: { id: tradeRecordId },
    });

    if (!tradeRecord) throw new Error('Trade record not found');

    // Update trade record
    await this.db.tradeRecord.update({
      where: { id: tradeRecordId },
      data: {
        exitPrice: parseFloat(exitPrice.toString()),
        pnl: parseFloat(pnl.toString()),
        pnlPercentage: parseFloat(pnlPercentage.toString()),
        exitReason,
        outcome: pnl > 0 ? 'win' : pnl < 0 ? 'loss' : 'neutral',
        completedAt: new Date(),
      },
    });

    // Update trading statistics
    await this.updateTradingStatistics(tradeRecord.userId);

    // Generate learning insights
    await this.generateLearningInsights(tradeRecord.userId, tradeRecord.symbol);
  }

  /**
   * Update trading statistics
   */
  private async updateTradingStatistics(userId: string): Promise<void> {
    const trades = await this.db.tradeRecord.findMany({
      where: { userId, completedAt: { not: null } },
    });

    if (trades.length === 0) return;

    const wins = trades.filter((t) => t.outcome === 'win');
    const losses = trades.filter((t) => t.outcome === 'loss');

    const totalProfit = wins.reduce((sum, t) => sum + (t.pnl || 0), 0);
    const totalLoss = Math.abs(losses.reduce((sum, t) => sum + (t.pnl || 0), 0));

    const stats = {
      totalTrades: trades.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: wins.length / trades.length,
      totalProfit,
      totalLoss,
      avgWin: wins.length > 0 ? totalProfit / wins.length : 0,
      avgLoss: losses.length > 0 ? totalLoss / losses.length : 0,
      profitFactor: totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? 999 : 0,
    };

    let existing = await this.db.tradingStatistics.findUnique({
      where: { userId },
    });

    if (existing) {
      await this.db.tradingStatistics.update({
        where: { userId },
        data: stats,
      });
    } else {
      await this.db.tradingStatistics.create({
        data: { userId, ...stats },
      });
    }
  }

  /**
   * Generate learning insights
   */
  private async generateLearningInsights(userId: string, symbol: string): Promise<void> {
    const period = new Date().toISOString().slice(0, 7); // YYYY-MM

    const trades = await this.db.tradeRecord.findMany({
      where: {
        userId,
        symbol,
        completedAt: {
          gte: new Date(`${period}-01`),
          lte: new Date(`${period}-31`),
        },
      },
    });

    if (trades.length === 0) return;

    const wins = trades.filter((t) => t.outcome === 'win');
    const losses = trades.filter((t) => t.outcome === 'loss');

    const winRate = wins.length / trades.length;
    const avgWin = wins.length > 0 ? wins.reduce((sum, t) => sum + (t.pnl || 0), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((sum, t) => sum + (t.pnl || 0), 0)) / losses.length : 0;
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 999 : 0;

    // Generate insights
    const insights: any[] = [];

    if (winRate > 0.6) {
      insights.push({
        category: 'performance',
        observation: 'High win rate detected',
        confidence: winRate,
        recommendation: 'Maintain current strategy parameters',
      });
    }

    if (profitFactor > 2) {
      insights.push({
        category: 'profitability',
        observation: 'Strong profit factor',
        confidence: Math.min(1, profitFactor / 3),
        recommendation: 'Maintain current risk management',
      });
    }

    // Generate improvement recommendations
    const improvements: string[] = [];

    if (winRate < 0.4) {
      improvements.push('Review entry/exit criteria, consider stricter filters');
    }

    if (profitFactor < 1) {
      improvements.push('Tighten stop losses or improve entry quality');
    }

    // Upsert learning record
    await this.db.learningRecord.upsert({
      where: { userId_period_symbol: { userId, period, symbol } },
      update: {
        successRate: winRate,
        avgWin: parseFloat(avgWin.toString()),
        avgLoss: parseFloat(avgLoss.toString()),
        profitFactor: parseFloat(profitFactor.toString()),
        totalTrades: trades.length,
        insights: insights as any,
        improvements,
      },
      create: {
        userId,
        period,
        symbol,
        successRate: winRate,
        avgWin: parseFloat(avgWin.toString()),
        avgLoss: parseFloat(avgLoss.toString()),
        profitFactor: parseFloat(profitFactor.toString()),
        totalTrades: trades.length,
        insights: insights as any,
        improvements,
      },
    });
  }

  /**
   * Get learning insights for symbol
   */
  async getLearningInsights(userId: string, symbol: string): Promise<LearningRecord | null> {
    const currentPeriod = new Date().toISOString().slice(0, 7);

    return await this.db.learningRecord.findUnique({
      where: { userId_period_symbol: { userId, period: currentPeriod, symbol } },
    }) as any;
  }

  /**
   * Get all learning records for user
   */
  async getAllLearningRecords(userId: string): Promise<LearningRecord[]> {
    return (await this.db.learningRecord.findMany({
      where: { userId },
      orderBy: { lastUpdated: 'desc' },
    })) as any;
  }

  /**
   * Store custom prompt template
   */
  async savePromptTemplate(userId: string, template: any): Promise<void> {
    await this.db.promptTemplate.upsert({
      where: { id: template.id },
      update: template,
      create: {
        userId,
        ...template,
      },
    });
  }

  /**
   * Get custom prompt templates
   */
  async getCustomPromptTemplates(userId: string): Promise<any[]> {
    return await this.db.promptTemplate.findMany({
      where: { userId, isCustom: true },
    });
  }

  /**
   * Save custom strategy template
   */
  async saveStrategyTemplate(userId: string, strategy: any): Promise<void> {
    await this.db.strategyTemplate.upsert({
      where: { id: strategy.id },
      update: strategy,
      create: {
        userId,
        ...strategy,
      },
    });
  }

  /**
   * Get custom strategy templates
   */
  async getCustomStrategyTemplates(userId: string): Promise<any[]> {
    return await this.db.strategyTemplate.findMany({
      where: { userId },
    });
  }

  /**
   * Log improvement
   */
  async logImprovement(
    userId: string,
    improvementType: string,
    description: string,
    metrics: any,
  ): Promise<void> {
    await this.db.improvementLog.create({
      data: {
        userId,
        improvementType,
        description,
        metrics,
      },
    });
  }

  /**
   * Get recommendation history
   */
  async getRecommendationHistory(userId: string, symbol?: string, limit = 50): Promise<any[]> {
    return await this.db.recommendation.findMany({
      where: {
        userId,
        ...(symbol && { symbol }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get trade history
   */
  async getTradeHistory(userId: string, symbol?: string, limit = 50): Promise<any[]> {
    return await this.db.tradeRecord.findMany({
      where: {
        userId,
        ...(symbol && { symbol }),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get brain configuration
   */
  getConfiguration(): any {
    return this.brain.getConfig();
  }

  /**
   * Update brain configuration
   */
  updateConfiguration(config: any): void {
    this.brain.updateConfig(config);
  }

  /**
   * Get AI brain instance for direct access
   */
  getBrain(): AITradingBrain {
    return this.brain;
  }
}

export { TradingBrainService as default };
