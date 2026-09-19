/**
 * Explanation Engine
 * Generates human-readable explanations for trading recommendations
 */

import { TradeRecommendation, RecommendationExplanation, AnalysisSource } from './types';

export class ExplanationEngine {
  /**
   * Generate comprehensive explanation for a recommendation
   */
  generateExplanation(recommendation: TradeRecommendation): string {
    const parts: string[] = [];

    // Opening summary
    parts.push(this.generateSummary(recommendation));

    // Technical analysis
    if (recommendation.sources.some((s) => s.type === 'technical')) {
      parts.push(this.generateTechnicalExplanation(recommendation));
    }

    // Sentiment analysis
    if (recommendation.sources.some((s) => s.type === 'sentiment')) {
      parts.push(this.generateSentimentExplanation(recommendation));
    }

    // Volume and liquidity
    if (
      recommendation.sources.some((s) => s.type === 'volume') ||
      recommendation.sources.some((s) => s.type === 'order_flow')
    ) {
      parts.push(this.generateVolumeExplanation(recommendation));
    }

    // Risk considerations
    if (recommendation.risks.length > 0) {
      parts.push(this.generateRiskExplanation(recommendation));
    }

    // Position sizing recommendation
    parts.push(this.generatePositionSizingAdvice(recommendation));

    // Price targets
    if (recommendation.entryPrice) {
      parts.push(this.generatePriceTargets(recommendation));
    }

    return parts.filter(Boolean).join('\n\n');
  }

  private generateSummary(rec: TradeRecommendation): string {
    const action = rec.action;
    const confidence = (rec.confidence * 100).toFixed(0);
    const rr = rec.riskRewardRatio.toFixed(2);

    return (
      `**${action} Signal for ${rec.symbol}**\n` +
      `Confidence: ${confidence}% | Risk/Reward: ${rr}:1\n` +
      `Analysis Time: ${new Date(rec.timestamp).toLocaleString()}`
    );
  }

  private generateTechnicalExplanation(rec: TradeRecommendation): string {
    const technical = rec.sources.find((s) => s.type === 'technical');
    if (!technical) return '';

    const signals = technical.signals.slice(0, 3).map((s) => `• ${s}`).join('\n');

    return `**Technical Analysis**\nConfidence: ${(technical.confidence * 100).toFixed(0)}%\n\nKey Signals:\n${signals}`;
  }

  private generateSentimentExplanation(rec: TradeRecommendation): string {
    const sentiment = rec.sources.find((s) => s.type === 'sentiment');
    if (!sentiment) return '';

    const signals = sentiment.signals.slice(0, 2).map((s) => `• ${s}`).join('\n');

    return (
      `**Market Sentiment**\nConfidence: ${(sentiment.confidence * 100).toFixed(0)}%\n\n` +
      `News & Social Signals:\n${signals}`
    );
  }

  private generateVolumeExplanation(rec: TradeRecommendation): string {
    const volume = rec.sources.find((s) => s.type === 'volume');
    const orderFlow = rec.sources.find((s) => s.type === 'order_flow');

    const parts: string[] = [];

    if (volume) {
      const signals = volume.signals.slice(0, 2).map((s) => `• ${s}`).join('\n');
      parts.push(`Volume Profile: ${signals}`);
    }

    if (orderFlow) {
      const signals = orderFlow.signals.slice(0, 2).map((s) => `• ${s}`).join('\n');
      parts.push(`Order Flow: ${signals}`);
    }

    return `**Volume & Flow Analysis**\n${parts.join('\n\n')}`;
  }

  private generateRiskExplanation(rec: TradeRecommendation): string {
    const highRisks = rec.risks.filter((r) => r.level === 'high');
    const mediumRisks = rec.risks.filter((r) => r.level === 'medium');

    const parts: string[] = ['**Risk Considerations**'];

    if (highRisks.length > 0) {
      parts.push(`High Risk Factors:\n${highRisks.map((r) => `• ${r.message}`).join('\n')}`);
      if (highRisks[0].mitigation) {
        parts.push(`Mitigation: ${highRisks[0].mitigation}`);
      }
    }

    if (mediumRisks.length > 0) {
      parts.push(`Medium Risk Factors:\n${mediumRisks.map((r) => `• ${r.message}`).join('\n')}`);
    }

    return parts.join('\n\n');
  }

  private generatePositionSizingAdvice(rec: TradeRecommendation): string {
    let advice = '**Position Sizing**\n';

    if (rec.riskRewardRatio < 1.5) {
      advice += '⚠️ Low R/R ratio - consider smaller position size';
    } else if (rec.riskRewardRatio > 3) {
      advice += '✅ Excellent R/R ratio - can consider full position size';
    } else {
      advice += '◆ Moderate R/R - standard position sizing recommended';
    }

    if (rec.confidence > 0.7) {
      advice += '\n✅ High confidence supports larger position';
    } else if (rec.confidence < 0.5) {
      advice += '\n⚠️ Lower confidence - reduce position size accordingly';
    }

    return advice;
  }

  private generatePriceTargets(rec: TradeRecommendation): string {
    if (!rec.entryPrice || !rec.exitPrice) return '';

    const lines: string[] = ['**Price Targets**'];

    lines.push(`Entry: $${rec.entryPrice.toFixed(2)}`);

    if (rec.takeProfit) {
      const profitPercentage = ((rec.takeProfit - rec.entryPrice) / rec.entryPrice * 100).toFixed(2);
      lines.push(`Take Profit: $${rec.takeProfit.toFixed(2)} (${profitPercentage}%)`);
    }

    if (rec.stopLoss) {
      const lossPercentage = ((rec.stopLoss - rec.entryPrice) / rec.entryPrice * 100).toFixed(2);
      lines.push(`Stop Loss: $${rec.stopLoss.toFixed(2)} (${lossPercentage}%)`);
    }

    lines.push(`Target Exit: $${rec.exitPrice.toFixed(2)}`);

    return lines.join('\n');
  }

  /**
   * Generate concise explanation for API response
   */
  generateConciseExplanation(rec: TradeRecommendation): string {
    const mainReasons: string[] = [];

    // Get top signals from each source
    for (const source of rec.sources) {
      if (source.signals.length > 0) {
        mainReasons.push(`${source.name}: ${source.signals[0]}`);
      }
    }

    return mainReasons.slice(0, 3).join(' | ');
  }

  /**
   * Generate explanation for recommendation changes
   */
  generateChangeExplanation(previous: TradeRecommendation, current: TradeRecommendation): string {
    if (previous.action === current.action && previous.confidence === current.confidence) {
      return 'No significant changes to recommendation';
    }

    const parts: string[] = [];

    if (previous.action !== current.action) {
      parts.push(`Action changed: ${previous.action} → ${current.action}`);
    }

    if (Math.abs(previous.confidence - current.confidence) > 0.1) {
      const change = current.confidence > previous.confidence ? 'increased' : 'decreased';
      const delta = Math.abs(current.confidence - previous.confidence);
      parts.push(`Confidence ${change}: ${(previous.confidence * 100).toFixed(0)}% → ${(current.confidence * 100).toFixed(0)}% (${(delta * 100).toFixed(1)}%)`);
    }

    // Find new signals
    const previousSignals = new Set(previous.sources.flatMap((s) => s.signals));
    const newSignals = current.sources
      .flatMap((s) => s.signals)
      .filter((s) => !previousSignals.has(s));

    if (newSignals.length > 0) {
      parts.push(`New signals: ${newSignals.slice(0, 2).join(', ')}`);
    }

    return parts.join('\n');
  }

  /**
   * Generate learning recommendations based on past performance
   */
  generateLearningRecommendation(historicalAccuracy: number, lastN: number): string {
    if (historicalAccuracy > 0.65) {
      return `✅ Strategy performing well (${(historicalAccuracy * 100).toFixed(1)}% accuracy on last ${lastN} trades). Continue monitoring.`;
    } else if (historicalAccuracy > 0.50) {
      return `◆ Strategy is neutral (${(historicalAccuracy * 100).toFixed(1)}% accuracy). Consider minor adjustments to entry criteria.`;
    } else {
      return `⚠️ Strategy underperforming (${(historicalAccuracy * 100).toFixed(1)}% accuracy). Review entry signals and risk management.`;
    }
  }
}

export class AnalysisReporter {
  /**
   * Generate analysis report for a symbol
   */
  generateAnalysisReport(rec: TradeRecommendation): {
    title: string;
    summary: string;
    analysis: string[];
    recommendation: string;
    risks: string[];
    confidence: string;
  } {
    return {
      title: `${rec.symbol} - ${rec.action} Analysis`,
      summary: this.generateSummary(rec),
      analysis: rec.sources.map((s) => `${s.name}: ${s.signals.join(', ')}`),
      recommendation: `${rec.action} at ${rec.entryPrice} with target ${rec.takeProfit} and stop ${rec.stopLoss}`,
      risks: rec.risks.map((r) => r.message),
      confidence: this.getConfidenceLabel(rec.confidence),
    };
  }

  private generateSummary(rec: TradeRecommendation): string {
    const trendWord = rec.action === 'BUY' ? 'Bullish' : rec.action === 'SELL' ? 'Bearish' : 'Neutral';
    return `${trendWord} sentiment. Multiple analysis types align toward ${rec.action}. Risk management in place.`;
  }

  private getConfidenceLabel(confidence: number): string {
    if (confidence > 0.8) return 'Very High';
    if (confidence > 0.6) return 'High';
    if (confidence > 0.4) return 'Moderate';
    if (confidence > 0.2) return 'Low';
    return 'Very Low';
  }
}
