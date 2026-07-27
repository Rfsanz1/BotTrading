/**
 * Technical Indicators Analysis Engine
 * Analyzes technical indicators and generates trading signals
 */

import { TechnicalIndicators } from './types';

export interface TechnicalInput {
  price: number;
  rsi?: number;
  macd?: { line: number; signal: number; histogram: number };
  ma20?: number;
  ma50?: number;
  ma200?: number;
  bollingerBands?: { upper: number; middle: number; lower: number };
  atr?: number;
  stochastic?: { k: number; d: number };
  obv?: number;
  adx?: number;
  priceHistory?: number[];
}

export class TechnicalAnalysisEngine {
  analyze(input: TechnicalInput): TechnicalIndicators {
    const signals: string[] = [];
    let trend: 'bullish' | 'bearish' | 'neutral' = 'neutral';
    const factors: number[] = [];

    // RSI Analysis (0-100, >70 overbought, <30 oversold)
    if (input.rsi !== undefined) {
      if (input.rsi > 70) {
        signals.push('RSI overbought - potential sell signal');
        factors.push(-0.2);
        trend = 'bearish';
      } else if (input.rsi < 30) {
        signals.push('RSI oversold - potential buy signal');
        factors.push(0.2);
        trend = 'bullish';
      } else if (input.rsi > 50) {
        factors.push(0.1);
      }
    }

    // MACD Analysis
    if (input.macd) {
      if (input.macd.histogram > 0) {
        signals.push('MACD positive - bullish momentum');
        factors.push(0.15);
      } else if (input.macd.histogram < 0) {
        signals.push('MACD negative - bearish momentum');
        factors.push(-0.15);
      }

      if (input.macd.line > input.macd.signal) {
        signals.push('MACD above signal - upward crossover');
        factors.push(0.1);
      }
    }

    // Moving Averages Analysis
    if (input.ma20 && input.ma50 && input.ma200) {
      if (input.ma20 > input.ma50 && input.ma50 > input.ma200) {
        signals.push('Golden cross - strong bullish trend');
        factors.push(0.3);
        trend = 'bullish';
      } else if (input.ma20 < input.ma50 && input.ma50 < input.ma200) {
        signals.push('Death cross - strong bearish trend');
        factors.push(-0.3);
        trend = 'bearish';
      }

      if (input.price > input.ma50) {
        signals.push('Price above 50MA - bullish alignment');
        factors.push(0.1);
      } else if (input.price < input.ma50) {
        signals.push('Price below 50MA - bearish alignment');
        factors.push(-0.1);
      }
    }

    // Bollinger Bands Analysis
    if (input.bollingerBands) {
      if (input.price > input.bollingerBands.upper) {
        signals.push('Price above upper Bollinger Band - potential reversal');
        factors.push(-0.1);
      } else if (input.price < input.bollingerBands.lower) {
        signals.push('Price below lower Bollinger Band - potential bounce');
        factors.push(0.1);
      }
    }

    // ATR Analysis (volatility)
    if (input.atr !== undefined) {
      const volatilityLevel = input.atr > input.price * 0.02 ? 'high' : 'normal';
      if (volatilityLevel === 'high') {
        signals.push('High volatility detected - adjust position sizing');
      }
    }

    // Stochastic Analysis
    if (input.stochastic) {
      if (input.stochastic.k > 80) {
        signals.push('Stochastic overbought');
        factors.push(-0.1);
      } else if (input.stochastic.k < 20) {
        signals.push('Stochastic oversold');
        factors.push(0.1);
      }
    }

    // ADX Analysis (trend strength)
    if (input.adx !== undefined) {
      if (input.adx > 25) {
        signals.push('Strong trend indicated by ADX');
        factors.push(0.15);
      } else if (input.adx < 20) {
        signals.push('Weak trend - ranging market');
        factors.push(-0.1);
        trend = 'neutral';
      }
    }

    // Calculate overall strength
    const strength = Math.max(0, Math.min(1, 0.5 + factors.reduce((a, b) => a + b, 0)));

    return {
      rsi: input.rsi,
      macd: input.macd,
      movingAverages: input.ma20 ? { ma20: input.ma20, ma50: input.ma50, ma200: input.ma200 } : undefined,
      bollingerBands: input.bollingerBands,
      atr: input.atr,
      stochastic: input.stochastic,
      obv: input.obv,
      adx: input.adx,
      trend,
      strength,
      signals,
    };
  }
}

export class TradingViewAlertAnalyzer {
  analyze(alerts: any[]): { aggregatedSignal: string; confidence: number; signals: string[] } {
    if (!alerts || alerts.length === 0) {
      return { aggregatedSignal: 'neutral', confidence: 0, signals: [] };
    }

    const signals = alerts.map((a) => a.message || a.type);
    const buyCount = alerts.filter((a) => a.type === 'buy').length;
    const sellCount = alerts.filter((a) => a.type === 'sell').length;
    const total = alerts.length;

    let aggregatedSignal: string;
    if (buyCount / total > 0.6) aggregatedSignal = 'buy';
    else if (sellCount / total > 0.6) aggregatedSignal = 'sell';
    else aggregatedSignal = 'hold';

    const confidence = Math.abs(buyCount - sellCount) / total;

    return { aggregatedSignal, confidence, signals };
  }
}

export class SentimentAnalysisEngine {
  analyze(
    sentiment: number,
    sources: Array<{ sentiment: string; score: number }>,
  ): { trend: string; impact: string } {
    const trend = sentiment > 0.3 ? 'improving' : sentiment < -0.3 ? 'declining' : 'stable';

    const absScore = Math.abs(sentiment);
    const impact = absScore > 0.6 ? 'high' : absScore > 0.3 ? 'medium' : 'low';

    return { trend, impact };
  }
}

export class MarketStructureAnalyzer {
  analyze(
    price: number,
    support: number[],
    resistance: number[],
    highLow: { high: number; low: number },
  ) {
    const priceAboveSupport = support.every((s) => price > s);
    const priceBelowResistance = resistance.every((r) => price < r);

    let trend: 'uptrend' | 'downtrend' | 'ranging';
    if (priceAboveSupport && priceBelowResistance) {
      trend = 'uptrend';
    } else if (!priceAboveSupport && !priceBelowResistance) {
      trend = 'downtrend';
    } else {
      trend = 'ranging';
    }

    const breakoutLevel = Math.max(...resistance);
    const breakdownLevel = Math.min(...support);

    return {
      trend,
      support,
      resistance,
      breakoutLevel,
      breakdownLevel,
      strength: this.calculateStructureStrength(price, support, resistance),
    };
  }

  private calculateStructureStrength(price: number, support: number[], resistance: number[]): number {
    const nearestSupport = Math.max(...support.filter((s) => s < price), 0);
    const nearestResistance = Math.min(...resistance.filter((r) => r > price), price * 2);

    const distance = nearestResistance - nearestSupport;
    const pricePosition = (price - nearestSupport) / distance;

    return Math.max(0, Math.min(1, 0.5 + (pricePosition - 0.5) * 0.5));
  }
}

export class VolumeAnalysisEngine {
  analyze(
    currentVolume: number,
    volumeHistory: number[],
    priceChange: number,
  ): { trend: string; correlation: number; signals: string[] } {
    const avgVolume = volumeHistory.reduce((a, b) => a + b, 0) / volumeHistory.length;
    const volumeChange = (currentVolume - avgVolume) / avgVolume;

    let trend: string;
    if (volumeChange > 0.2) {
      trend = 'increasing';
    } else if (volumeChange < -0.2) {
      trend = 'decreasing';
    } else {
      trend = 'stable';
    }

    const correlation = Math.sign(priceChange) === Math.sign(volumeChange) ? 1 : -1;

    const signals: string[] = [];
    if (volumeChange > 0.5 && Math.sign(priceChange) > 0) {
      signals.push('Strong bullish volume');
    } else if (volumeChange > 0.5 && Math.sign(priceChange) < 0) {
      signals.push('High volume on down move - potential weakness');
    }

    return { trend, correlation, signals };
  }
}

export class LiquidityAnalyzer {
  analyze(bidAskSpread: number, price: number, orderBook: any): { score: number; impact: string } {
    const spreadPercentage = (bidAskSpread / price) * 100;

    let score: number;
    if (spreadPercentage < 0.05) score = 1;
    else if (spreadPercentage < 0.1) score = 0.8;
    else if (spreadPercentage < 0.2) score = 0.6;
    else if (spreadPercentage < 0.5) score = 0.4;
    else score = 0.2;

    const impact = score > 0.7 ? 'low' : score > 0.4 ? 'medium' : 'high';

    return { score, impact };
  }
}

export class RiskAnalysisEngine {
  analyze(
    portfolio: any,
    position: any,
    volatility: number,
  ): { overallRisk: string; score: number; signals: string[] } {
    const signals: string[] = [];

    // Calculate portfolio heat
    const portfolioHeat = portfolio.totalExposure || 0;
    if (portfolioHeat > 0.5) {
      signals.push('High portfolio heat - exposure above 50%');
    }

    // Check concentration
    const concentration = position.size / (portfolio.totalValue || 1);
    if (concentration > 0.2) {
      signals.push('Concentrated position - above 20% of portfolio');
    }

    // Volatility check
    if (volatility > 0.03) {
      signals.push('High volatility detected');
    }

    // Determine risk level
    let overallRisk: string;
    let score: number;

    if (portfolioHeat > 0.5 && concentration > 0.2 && volatility > 0.03) {
      overallRisk = 'high';
      score = 0.8;
    } else if (portfolioHeat > 0.3 || concentration > 0.15 || volatility > 0.02) {
      overallRisk = 'medium';
      score = 0.5;
    } else {
      overallRisk = 'low';
      score = 0.2;
    }

    return { overallRisk, score, signals };
  }
}
