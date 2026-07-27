/**
 * Learning and History Storage System
 * Tracks trade performance and learns from historical data
 */

import { TradeHistory, LearningRecord, Insight } from './types';

export class LearningSystem {
  /**
   * Analyze trade history to extract insights
   */
  analyzeTradingHistory(trades: TradeHistory[]): LearningRecord {
    if (trades.length === 0) {
      return this.createEmptyLearningRecord();
    }

    const completedTrades = trades.filter((t) => t.result);
    const wins = completedTrades.filter((t) => t.result!.pnl > 0);
    const losses = completedTrades.filter((t) => t.result!.pnl < 0);

    const successRate = wins.length / completedTrades.length;
    const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + (b.result?.pnl || 0), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + Math.abs(b.result?.pnl || 0), 0) / losses.length : 0;
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 999 : 0;

    const insights = this.extractInsights(completedTrades, wins, losses, successRate, profitFactor);
    const improvements = this.recommendImprovements(trades, insights);

    return {
      id: `learning-${Date.now()}`,
      period: new Date().toISOString().slice(0, 7), // YYYY-MM
      symbol: trades[0]?.recommendation.symbol || 'UNKNOWN',
      successRate,
      avgWin,
      avgLoss,
      profitFactor,
      totalTrades: completedTrades.length,
      insights,
      improvements,
      lastUpdated: Date.now(),
    };
  }

  /**
   * Extract insights from trades
   */
  private extractInsights(
    completedTrades: TradeHistory[],
    wins: TradeHistory[],
    losses: TradeHistory[],
    successRate: number,
    profitFactor: number,
  ): Insight[] {
    const insights: Insight[] = [];

    // Insight 1: Win rate assessment
    if (successRate > 0.6) {
      insights.push({
        category: 'performance',
        observation: 'High win rate detected',
        confidence: successRate,
        recommendation: 'Maintain current strategy parameters',
      });
    } else if (successRate < 0.4) {
      insights.push({
        category: 'performance',
        observation: 'Low win rate - strategy needs adjustment',
        confidence: 1 - successRate,
        recommendation: 'Review entry/exit criteria, consider stricter filters',
      });
    }

    // Insight 2: Profit factor
    if (profitFactor > 2) {
      insights.push({
        category: 'profitability',
        observation: 'Strong profit factor indicates good risk/reward',
        confidence: Math.min(1, profitFactor / 3),
        recommendation: 'Maintain current risk management',
      });
    } else if (profitFactor < 1) {
      insights.push({
        category: 'profitability',
        observation: 'Poor profit factor - losses exceed wins',
        confidence: 0.8,
        recommendation: 'Tighten stop losses or improve entry quality',
      });
    }

    // Insight 3: Trade patterns
    const avgDuration =
      completedTrades.reduce((a, b) => a + (b.result?.duration || 0), 0) / completedTrades.length;
    const quickTrades = completedTrades.filter((t) => (t.result?.duration || 0) < avgDuration / 2).length;

    if (quickTrades > completedTrades.length * 0.5) {
      insights.push({
        category: 'timing',
        observation: 'Many quick exits detected',
        confidence: quickTrades / completedTrades.length,
        recommendation: 'Consider giving positions more time or adjusting TP/SL',
      });
    }

    // Insight 4: Win/loss ratio
    if (wins.length > 0 && losses.length > 0) {
      const winLossRatio = wins.length / losses.length;
      if (winLossRatio > 1.5) {
        insights.push({
          category: 'risk_management',
          observation: 'Good win to loss ratio',
          confidence: Math.min(1, winLossRatio / 2),
          recommendation: 'Strategy risk management is effective',
        });
      }
    }

    return insights;
  }

  /**
   * Recommend improvements based on analysis
   */
  private recommendImprovements(trades: TradeHistory[], insights: Insight[]): string[] {
    const improvements: string[] = [];

    // Base recommendations on insights
    for (const insight of insights) {
      improvements.push(insight.recommendation);
    }

    // Analyze confidence patterns
    const avgConfidence =
      trades.reduce((a, b) => a + b.recommendation.confidence, 0) / Math.max(1, trades.length);
    if (avgConfidence < 0.5) {
      improvements.push('Increase analysis depth - current confidence too low');
    }

    // Analyze recommendation sources
    const sourceTypes = new Set<string>();
    for (const trade of trades) {
      for (const source of trade.recommendation.sources) {
        sourceTypes.add(source.type);
      }
    }

    if (sourceTypes.size < 4) {
      improvements.push('Add more analysis types for better consensus');
    }

    // Risk improvement
    const highRiskTrades = trades.filter((t) => t.recommendation.confidence < 0.4);
    if (highRiskTrades.length > trades.length * 0.3) {
      improvements.push('Implement stricter confidence thresholds before trading');
    }

    return [...new Set(improvements)];
  }

  private createEmptyLearningRecord(): LearningRecord {
    return {
      id: `learning-${Date.now()}`,
      period: new Date().toISOString().slice(0, 7),
      symbol: 'UNKNOWN',
      successRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      totalTrades: 0,
      insights: [],
      improvements: [],
      lastUpdated: Date.now(),
    };
  }

  /**
   * Calculate comparison between two periods
   */
  comparePeriods(previous: LearningRecord, current: LearningRecord): {
    improvement: string;
    metrics: Record<string, number>;
  } {
    const metrics = {
      successRateChange: current.successRate - previous.successRate,
      profitFactorChange: current.profitFactor - previous.profitFactor,
      avgWinChange: current.avgWin - previous.avgWin,
      tradeVolumeChange: current.totalTrades - previous.totalTrades,
    };

    let improvement = 'stable';
    if (
      metrics.successRateChange > 0.1 ||
      metrics.profitFactorChange > 0.5 ||
      metrics.avgWinChange > 0
    ) {
      improvement = 'improved';
    } else if (
      metrics.successRateChange < -0.1 ||
      metrics.profitFactorChange < -0.5 ||
      metrics.avgWinChange < 0
    ) {
      improvement = 'declined';
    }

    return { improvement, metrics };
  }

  /**
   * Identify trading patterns from history
   */
  identifyPatterns(trades: TradeHistory[]): {
    timeOfDayBias?: { hour: number; winRate: number };
    symbolBias?: Record<string, number>;
    conditionBias?: Record<string, number>;
  } {
    const byTimeOfDay: Record<number, TradeHistory[]> = {};
    const bySymbol: Record<string, TradeHistory[]> = {};
    const byCondition: Record<string, TradeHistory[]> = {};

    for (const trade of trades) {
      if (!trade.result) continue;

      // Time of day
      const hour = new Date(trade.timestamp).getHours();
      if (!byTimeOfDay[hour]) byTimeOfDay[hour] = [];
      byTimeOfDay[hour].push(trade);

      // Symbol
      const symbol = trade.recommendation.symbol;
      if (!bySymbol[symbol]) bySymbol[symbol] = [];
      bySymbol[symbol].push(trade);

      // Condition (first signal)
      const condition = trade.recommendation.sources[0]?.name || 'unknown';
      if (!byCondition[condition]) byCondition[condition] = [];
      byCondition[condition].push(trade);
    }

    // Calculate win rates
    const timeOfDayBias = Object.entries(byTimeOfDay)
      .map(([hour, trades]) => {
        const winRate = trades.filter((t) => t.result!.pnl > 0).length / trades.length;
        return { hour: parseInt(hour), winRate };
      })
      .sort((a, b) => b.winRate - a.winRate)[0];

    const symbolBias = Object.fromEntries(
      Object.entries(bySymbol).map(([symbol, trades]) => [
        symbol,
        trades.filter((t) => t.result!.pnl > 0).length / trades.length,
      ]),
    );

    const conditionBias = Object.fromEntries(
      Object.entries(byCondition).map(([condition, trades]) => [
        condition,
        trades.filter((t) => t.result!.pnl > 0).length / trades.length,
      ]),
    );

    return { timeOfDayBias, symbolBias, conditionBias };
  }
}

export class TradeResultAnalyzer {
  /**
   * Calculate risk/reward ratio accuracy
   */
  analyzeRiskRewardAccuracy(
    recommendation: { stopLoss?: number; takeProfit?: number; entryPrice?: number },
    result: { exitPrice: number; exitReason: string },
  ): {
    targetMet: boolean;
    slHit: boolean;
    ratio: number;
  } {
    if (!recommendation.entryPrice) {
      return { targetMet: false, slHit: false, ratio: 0 };
    }

    const targetMet =
      recommendation.takeProfit &&
      ((result.exitPrice >= recommendation.takeProfit && result.exitPrice > recommendation.entryPrice) ||
        (result.exitPrice <= recommendation.takeProfit && result.exitPrice < recommendation.entryPrice));

    const slHit =
      recommendation.stopLoss &&
      Math.abs(result.exitPrice - recommendation.stopLoss) < Math.abs(result.exitPrice - recommendation.entryPrice) * 0.02; // 2% tolerance

    const expectedRR =
      recommendation.takeProfit && recommendation.stopLoss
        ? Math.abs(recommendation.takeProfit - recommendation.entryPrice) /
          Math.abs(recommendation.entryPrice - recommendation.stopLoss)
        : 0;

    return { targetMet, slHit, ratio: expectedRR };
  }

  /**
   * Analyze slippage and execution quality
   */
  analyzeExecutionQuality(
    recommendation: { entryPrice?: number },
    result: { executedPrice: number; targetPrice?: number },
  ): {
    slippage: number;
    quality: 'excellent' | 'good' | 'fair' | 'poor';
  } {
    if (!recommendation.entryPrice) {
      return { slippage: 0, quality: 'fair' };
    }

    const slippage = Math.abs(result.executedPrice - recommendation.entryPrice) / recommendation.entryPrice;

    let quality: 'excellent' | 'good' | 'fair' | 'poor';
    if (slippage < 0.001) quality = 'excellent';
    else if (slippage < 0.005) quality = 'good';
    else if (slippage < 0.01) quality = 'fair';
    else quality = 'poor';

    return { slippage, quality };
  }
}
