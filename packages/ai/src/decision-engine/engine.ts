import { DecisionAction, DecisionInput, DecisionOutput, RiskSettings, TechnicalIndicators, TradingViewAlert } from './types';

export class TradingDecisionEngine {
  evaluate(input: DecisionInput): DecisionOutput {
    const price = input.marketData.price;
    const technical = input.technical || {};
    const news = input.news || {};
    const alerts = input.alerts || [];
    const portfolio = input.portfolio || {};
    const riskSettings = input.riskSettings || {};

    const buyScore = this.scoreBuy(technical, news, alerts, input.aiConsensus, price);
    const sellScore = this.scoreSell(technical, news, alerts, input.aiConsensus, price);
    const holdScore = this.scoreHold(technical, news, alerts, price);

    const normalized = this.normalizeScores(buyScore, sellScore, holdScore);
    const action = this.resolveAction(normalized);

    const confidence = this.computeConfidence(normalized, input.aiConsensus, riskSettings);
    const risk = this.computeRiskLevel(confidence, portfolio, riskSettings);
    const entry = price;
    const stopLoss = this.computeStopLoss(price, technical.atr, risk);
    const takeProfit = this.computeTakeProfit(price, stopLoss, riskSettings.riskRewardMin || 2);
    const positionSize = this.computePositionSize(price, portfolio, riskSettings, confidence, risk);
    const explanation = this.buildExplanation(action, normalized, confidence, risk, entry, stopLoss, takeProfit, positionSize);

    return {
      action,
      buyScore: normalized.buy,
      sellScore: normalized.sell,
      holdScore: normalized.hold,
      confidence,
      risk,
      entry,
      stopLoss,
      takeProfit,
      positionSize,
      explanation,
      reasons: this.buildReasons(technical, news, alerts, input.aiConsensus),
      metadata: {
        marketBias: this.marketBias(normalized),
        riskReward: (takeProfit - entry) / Math.max(stopLoss - entry, 1e-6),
        confidenceBand: this.confidenceBand(confidence),
      },
    };
  }

  private scoreBuy(technical: TechnicalIndicators, news: any, alerts: TradingViewAlert[], ai: any, price: number): number {
    let score = 0.3;
    if ((technical.rsi || 50) < 70) score += 0.15;
    if ((technical.macd || 0) > 0) score += 0.15;
    if ((technical.ma20 || price) > (technical.ma50 || price)) score += 0.15;
    if ((news.score || 0) > 0) score += 0.15;
    if (alerts.some((a) => a.type === 'buy')) score += 0.2;
    if ((ai?.confidence || 0) > 0.5) score += 0.1;
    return Math.min(1, score);
  }

  private scoreSell(technical: TechnicalIndicators, news: any, alerts: TradingViewAlert[], ai: any, price: number): number {
    let score = 0.2;
    if ((technical.rsi || 50) > 70) score += 0.15;
    if ((technical.macd || 0) < 0) score += 0.15;
    if ((technical.ma20 || price) < (technical.ma50 || price)) score += 0.15;
    if ((news.score || 0) < 0) score += 0.15;
    if (alerts.some((a) => a.type === 'sell')) score += 0.2;
    if ((ai?.confidence || 0) > 0.5) score += 0.1;
    return Math.min(1, score);
  }

  private scoreHold(technical: TechnicalIndicators, news: any, alerts: TradingViewAlert[], price: number): number {
    let score = 0.25;
    if ((technical.volatility || 0) > 0.03) score += 0.1;
    if ((news.impact || 'low') === 'high') score += 0.1;
    if (alerts.some((a) => a.type === 'hold' || a.type === 'alert')) score += 0.15;
    if ((technical.rsi || 50) > 45 && (technical.rsi || 50) < 55) score += 0.1;
    return Math.min(1, score);
  }

  private normalizeScores(buy: number, sell: number, hold: number) {
    const total = buy + sell + hold;
    return {
      buy: buy / total,
      sell: sell / total,
      hold: hold / total,
    };
  }

  private resolveAction(scores: { buy: number; sell: number; hold: number }): DecisionAction {
    const max = Math.max(scores.buy, scores.sell, scores.hold);
    if (max === scores.buy && scores.buy > scores.sell + 0.05) return 'BUY';
    if (max === scores.sell && scores.sell > scores.buy + 0.05) return 'SELL';
    return 'HOLD';
  }

  private computeConfidence(scores: { buy: number; sell: number; hold: number }, ai: any, riskSettings: RiskSettings) {
    const margin = Math.abs(scores.buy - scores.sell);
    const aiBoost = (ai?.confidence || 0) * 0.2;
    const thresholdBoost = riskSettings.confidenceThreshold ? 0.1 : 0;
    return Math.min(1, 0.45 + margin * 0.4 + aiBoost + thresholdBoost);
  }

  private computeRiskLevel(confidence: number, portfolio: any, riskSettings: RiskSettings): 'low' | 'medium' | 'high' {
    const concentration = portfolio.concentrationRisk || 0;
    const drawdown = riskSettings.maxDrawdownPct || 0.1;
    if (confidence < 0.5 || concentration > 0.3 || drawdown > 0.15) return 'high';
    if (confidence < 0.7 || concentration > 0.15) return 'medium';
    return 'low';
  }

  private computeStopLoss(price: number, atr: number | undefined, risk: 'low' | 'medium' | 'high') {
    const multiplier = risk === 'high' ? 0.015 : risk === 'medium' ? 0.02 : 0.025;
    const atrBuffer = (atr || price * 0.01) * 0.5;
    return price - Math.max(atrBuffer, price * multiplier);
  }

  private computeTakeProfit(price: number, stopLoss: number, riskRewardMin: number) {
    const riskDistance = Math.max(price - stopLoss, 1e-6);
    return price + riskDistance * riskRewardMin;
  }

  private computePositionSize(price: number, portfolio: any, riskSettings: RiskSettings, confidence: number, risk: 'low' | 'medium' | 'high') {
    const maxPositionPct = riskSettings.maxPositionSizePct || 0.05;
    const riskPct = riskSettings.maxRiskPct || 0.01;
    const base = Math.min(maxPositionPct, riskPct / Math.max(confidence, 0.3));
    const riskMultiplier = risk === 'high' ? 0.5 : risk === 'medium' ? 0.75 : 1;
    return Math.max(0.001, base * riskMultiplier * 100);
  }

  private buildExplanation(action: DecisionAction, scores: { buy: number; sell: number; hold: number }, confidence: number, risk: 'low' | 'medium' | 'high', entry: number, stopLoss: number, takeProfit: number, positionSize: number) {
    return [
      `${action} decision driven by score balance: buy=${(scores.buy * 100).toFixed(0)}%, sell=${(scores.sell * 100).toFixed(0)}%, hold=${(scores.hold * 100).toFixed(0)}%.`,
      `Confidence is ${(confidence * 100).toFixed(0)}% with ${risk} risk profile.`,
      `Entry ${entry.toFixed(2)}, stop loss ${stopLoss.toFixed(2)}, take profit ${takeProfit.toFixed(2)}, and position size ${positionSize.toFixed(2)}%.`,
      'The recommendation is explainable and can be traced to technical, news, alert, portfolio, and risk inputs.',
    ].join(' ');
  }

  private buildReasons(technical: any, news: any, alerts: TradingViewAlert[], ai: any) {
    const reasons = [] as string[];
    if (technical.rsi !== undefined) reasons.push(`RSI ${technical.rsi.toFixed(1)}`);
    if (technical.macd !== undefined) reasons.push(`MACD ${technical.macd.toFixed(3)}`);
    if (news.score !== undefined) reasons.push(`News score ${news.score.toFixed(2)}`);
    if (alerts.length > 0) reasons.push(`Alerts: ${alerts.map((a) => a.type || 'alert').join(', ')}`);
    if (ai?.recommendation) reasons.push(`AI recommendation: ${ai.recommendation}`);
    return reasons;
  }

  private marketBias(scores: { buy: number; sell: number; hold: number }) {
    if (scores.buy > scores.sell && scores.buy > scores.hold) return 'bullish';
    if (scores.sell > scores.buy && scores.sell > scores.hold) return 'bearish';
    return 'neutral';
  }

  private confidenceBand(confidence: number) {
    if (confidence > 0.8) return 'very-high';
    if (confidence > 0.6) return 'high';
    if (confidence > 0.4) return 'medium';
    return 'low';
  }
}

export default TradingDecisionEngine;
