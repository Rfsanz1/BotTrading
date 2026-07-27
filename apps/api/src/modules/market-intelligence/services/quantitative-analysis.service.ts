import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { QuantitativeAnalysisRepository } from '../quantitative-analysis.repository';

export interface Candle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorBundle {
  symbol: string;
  timeframe: string;
  exchange: string;
  generatedAt: string;
  indicators: Record<string, any>;
}

@Injectable()
export class QuantitativeAnalysisService {
  private readonly logger = new Logger(QuantitativeAnalysisService.name);

  constructor(
    private readonly repository?: QuantitativeAnalysisRepository,
    private readonly eventEmitter?: EventEmitter2,
  ) {}

  async calculate(symbol: string, timeframe: string, exchange: string, candles: Candle[]): Promise<IndicatorBundle> {
    if (!candles.length) {
      throw new Error('At least one candle is required');
    }

    const closes = candles.map((c) => c.close);
    const highs = candles.map((c) => c.high);
    const lows = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);
    const opens = candles.map((c) => c.open);

    const ema = this.calculateEma(closes);
    const sma = this.calculateSma(closes);
    const vwap = this.calculateVwap(candles);
    const macd = this.calculateMacd(closes);
    const rsi = this.calculateRsi(closes);
    const atr = this.calculateAtr(candles);
    const adx = this.calculateAdx(candles);
    const cci = this.calculateCci(candles);
    const stochasticRsi = this.calculateStochasticRsi(closes);
    const bollingerBands = this.calculateBollingerBands(closes);
    const superTrend = this.calculateSuperTrend(candles);
    const ichimoku = this.calculateIchimoku(candles);
    const obv = this.calculateObv(candles);
    const cmf = this.calculateCmf(candles);
    const mfi = this.calculateMfi(candles);
    const volumeDelta = this.calculateVolumeDelta(candles);
    const volumeProfile = this.calculateVolumeProfile(candles);
    const orderBlocks = this.calculateOrderBlocks(candles);
    const fairValueGap = this.calculateFairValueGap(candles);
    const liquidity = this.calculateLiquidity(candles);
    const marketStructure = this.calculateMarketStructure(candles);
    const breakOfStructure = this.calculateBreakOfStructure(candles);
    const changeOfCharacter = this.calculateChangeOfCharacter(candles);

    const bundle: IndicatorBundle = {
      symbol,
      timeframe,
      exchange,
      generatedAt: new Date().toISOString(),
      indicators: {
        ema: { value: ema.value, last: ema.last },
        sma: { value: sma.value, last: sma.last },
        vwap: { value: vwap.value, last: vwap.last },
        macd: {
          macdLine: macd.macdLine,
          signalLine: macd.signalLine,
          histogram: macd.histogram,
        },
        rsi: { value: rsi.value },
        atr: { value: atr.value },
        adx: { value: adx.value },
        cci: { value: cci.value },
        stochasticRsi: { value: stochasticRsi.value },
        bollingerBands: bollingerBands,
        superTrend: superTrend,
        ichimoku: ichimoku,
        obv: obv,
        cmf: cmf,
        mfi: mfi,
        volumeDelta: volumeDelta,
        volumeProfile: volumeProfile,
        orderBlocks: orderBlocks,
        fairValueGap: fairValueGap,
        liquidity: liquidity,
        marketStructure: marketStructure,
        breakOfStructure: breakOfStructure,
        changeOfCharacter: changeOfCharacter,
        raw: {
          closes,
          highs,
          lows,
          opens,
          volumes,
        },
      },
    };

    if (this.repository) {
      try {
        await this.repository.save(bundle);
      } catch (error) {
        this.logger.warn(`Unable to persist quantitative indicators for ${symbol}/${timeframe}: ${error instanceof Error ? error.message : error}`);
      }
    }

    if (this.eventEmitter) {
      this.eventEmitter.emit('quantitative.indicators.calculated', bundle);
    }

    return bundle;
  }

  private calculateEma(closes: number[]): { value: number; last: number | null } {
    const period = 14;
    const multiplier = 2 / (period + 1);
    const initialSma = closes.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
    const emaValues = closes.map((value, index) => {
      if (index === 0) {
        return initialSma;
      }
      return value * multiplier + (emaValues[index - 1] ?? initialSma) * (1 - multiplier);
    });
    const last = emaValues.at(-1) ?? null;
    return { value: last, last };
  }

  private calculateSma(closes: number[]): { value: number; last: number | null } {
    const period = 14;
    const values = closes.slice(-period);
    const last = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
    return { value: last, last };
  }

  private calculateVwap(candles: Candle[]): { value: number; last: number | null } {
    const total = candles.reduce((sum, candle) => sum + candle.close * candle.volume, 0);
    const volume = candles.reduce((sum, candle) => sum + candle.volume, 0);
    const last = volume ? total / volume : null;
    return { value: last, last };
  }

  private calculateMacd(closes: number[]): { macdLine: number | null; signalLine: number | null; histogram: number | null } {
    const ema12 = this.emaSeries(closes, 12);
    const ema26 = this.emaSeries(closes, 26);
    const macdLine = ema12.at(-1)! - ema26.at(-1)!;
    const signalLine = this.emaSeries([macdLine], 9).at(-1) ?? null;
    return {
      macdLine,
      signalLine,
      histogram: macdLine !== null && signalLine !== null ? macdLine - signalLine : null,
    };
  }

  private calculateRsi(closes: number[]): { value: number | null } {
    if (closes.length < 2) {
      return { value: null };
    }
    let gains = 0;
    let losses = 0;
    for (let index = 1; index < closes.length; index += 1) {
      const change = closes[index] - closes[index - 1];
      if (change >= 0) {
        gains += change;
      } else {
        losses += Math.abs(change);
      }
    }
    const avgGain = gains / (closes.length - 1);
    const avgLoss = losses / (closes.length - 1);
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    const value = 100 - 100 / (1 + rs);
    return { value };
  }

  private calculateAtr(candles: Candle[]): { value: number | null } {
    if (candles.length < 2) {
      return { value: null };
    }
    const trValues = candles.slice(1).map((candle, index) => {
      const prev = candles[index];
      return Math.max(candle.high - candle.low, Math.abs(candle.high - prev.close), Math.abs(candle.low - prev.close));
    });
    const value = trValues.reduce((sum, item) => sum + item, 0) / trValues.length;
    return { value };
  }

  private calculateAdx(candles: Candle[]): { value: number | null } {
    if (candles.length < 14) {
      return { value: null };
    }
    const dx = this.calculateDx(candles.slice(-14));
    return { value: dx };
  }

  private calculateDx(candles: Candle[]): number | null {
    const upMoves = candles.slice(1).map((candle, index) => candle.high - candles[index].high);
    const downMoves = candles.slice(1).map((candle, index) => candles[index].low - candle.low);
    const plusDm = upMoves.map((move, index) => (move > downMoves[index] && move > 0 ? move : 0));
    const minusDm = downMoves.map((move, index) => (move > upMoves[index] && move > 0 ? move : 0));
    const plusDi = (plusDm.reduce((sum, item) => sum + item, 0) / (candles.at(-1)!.high - candles[0].low)) * 100;
    const minusDi = (minusDm.reduce((sum, item) => sum + item, 0) / (candles.at(-1)!.high - candles[0].low)) * 100;
    const dx = Math.abs(plusDi - minusDi) / (plusDi + minusDi) * 100;
    return Number.isFinite(dx) ? dx : null;
  }

  private calculateCci(candles: Candle[]): { value: number | null } {
    const typicalPrices = candles.map((candle) => (candle.high + candle.low + candle.close) / 3);
    const mean = typicalPrices.reduce((sum, item) => sum + item, 0) / typicalPrices.length;
    const deviation = typicalPrices.reduce((sum, item) => sum + Math.abs(item - mean), 0) / typicalPrices.length;
    const lastTypical = typicalPrices.at(-1) ?? 0;
    const value = deviation === 0 ? 0 : (lastTypical - mean) / (0.015 * deviation);
    return { value };
  }

  private calculateStochasticRsi(closes: number[]): { value: number | null } {
    const period = 14;
    const window = closes.slice(-period);
    if (!window.length) return { value: null };
    const min = Math.min(...window);
    const max = Math.max(...window);
    const value = max === min ? 50 : ((window.at(-1)! - min) / (max - min)) * 100;
    return { value };
  }

  private calculateBollingerBands(closes: number[]): { upper: number | null; middle: number | null; lower: number | null } {
    const period = 20;
    const window = closes.slice(-period);
    if (!window.length) return { upper: null, middle: null, lower: null };
    const middle = window.reduce((sum, item) => sum + item, 0) / window.length;
    const variance = window.reduce((sum, item) => sum + (item - middle) ** 2, 0) / window.length;
    const std = Math.sqrt(variance);
    return {
      upper: middle + 2 * std,
      middle,
      lower: middle - 2 * std,
    };
  }

  private calculateSuperTrend(candles: Candle[]): { value: number | null; direction: string } {
    if (candles.length < 2) {
      return { value: null, direction: 'neutral' };
    }
    const atr = this.calculateAtr(candles).value ?? 0;
    const last = candles.at(-1)!;
    const value = last.close + atr * 0.5;
    return { value, direction: last.close >= last.open ? 'bullish' : 'bearish' };
  }

  private calculateIchimoku(candles: Candle[]): { conversionLine: number | null; baseLine: number | null; leadingSpanA: number | null; leadingSpanB: number | null } {
    const recent = candles.slice(-9);
    const conversionLine = recent.length ? recent.reduce((sum, candle) => sum + candle.low, 0) / recent.length : null;
    const baseLine = candles.length ? candles.slice(-26).reduce((sum, candle) => sum + candle.high, 0) / Math.min(26, candles.length) : null;
    return {
      conversionLine,
      baseLine,
      leadingSpanA: conversionLine !== null && baseLine !== null ? (conversionLine + baseLine) / 2 : null,
      leadingSpanB: baseLine,
    };
  }

  private calculateObv(candles: Candle[]): { value: number | null } {
    let value = 0;
    for (const candle of candles) {
      if (candle.close > candle.open) {
        value += candle.volume;
      } else if (candle.close < candle.open) {
        value -= candle.volume;
      }
    }
    return { value };
  }

  private calculateCmf(candles: Candle[]): { value: number | null } {
    const moneyFlow = candles.reduce((sum, candle) => sum + (candle.close - candle.open) * candle.volume, 0);
    const totalVolume = candles.reduce((sum, candle) => sum + candle.volume, 0);
    return { value: totalVolume ? moneyFlow / totalVolume : null };
  }

  private calculateMfi(candles: Candle[]): { value: number | null } {
    const typicalPrices = candles.map((candle) => (candle.high + candle.low + candle.close) / 3);
    const rawMoneyFlow = typicalPrices.map((price, index) => price * candles[index].volume);
    const sumPositive = rawMoneyFlow.reduce((sum, value, index) => sum + (index > 0 && typicalPrices[index] > typicalPrices[index - 1] ? value : 0), 0);
    const sumNegative = rawMoneyFlow.reduce((sum, value, index) => sum + (index > 0 && typicalPrices[index] < typicalPrices[index - 1] ? value : 0), 0);
    const moneyRatio = sumNegative === 0 ? 100 : 100 - (100 / (1 + sumPositive / sumNegative));
    return { value: Number.isFinite(moneyRatio) ? moneyRatio : null };
  }

  private calculateVolumeDelta(candles: Candle[]): { value: number | null } {
    const delta = candles.reduce((sum, candle) => sum + candle.volume * (candle.close > candle.open ? 1 : -1), 0);
    return { value: delta };
  }

  private calculateVolumeProfile(candles: Candle[]): { levels: Array<{ price: number; volume: number }> } {
    const levels = candles.reduce<Map<number, number>>((acc, candle) => {
      const price = Number(((candle.high + candle.low) / 2).toFixed(2));
      acc.set(price, (acc.get(price) ?? 0) + candle.volume);
      return acc;
    }, new Map());

    return {
      levels: Array.from(levels.entries())
        .map(([price, volume]) => ({ price, volume }))
        .sort((left, right) => right.volume - left.volume)
        .slice(0, 5),
    };
  }

  private calculateOrderBlocks(candles: Candle[]): { bullish: Array<{ start: number; end: number }>; bearish: Array<{ start: number; end: number }> } {
    const bullish = candles.filter((candle) => candle.close > candle.open).map((candle) => ({ start: candle.low, end: candle.high }));
    const bearish = candles.filter((candle) => candle.close < candle.open).map((candle) => ({ start: candle.low, end: candle.high }));
    return { bullish, bearish };
  }

  private calculateFairValueGap(candles: Candle[]): { bullish: Array<{ low: number; high: number }>; bearish: Array<{ low: number; high: number }> } {
    const bullish = candles.filter((candle, index) => index > 0 && candle.low > candles[index - 1].high).map((candle) => ({ low: candle.low, high: candle.high }));
    const bearish = candles.filter((candle, index) => index > 0 && candle.high < candles[index - 1].low).map((candle) => ({ low: candle.low, high: candle.high }));
    return { bullish, bearish };
  }

  private calculateLiquidity(candles: Candle[]): { support: Array<number>; resistance: Array<number> } {
    const support = candles.map((candle) => candle.low).slice(-5);
    const resistance = candles.map((candle) => candle.high).slice(-5);
    return { support, resistance };
  }

  private calculateMarketStructure(candles: Candle[]): { trend: string; highs: number[]; lows: number[] } {
    const highs = candles.map((candle) => candle.high);
    const lows = candles.map((candle) => candle.low);
    const lastHigh = highs.at(-1) ?? 0;
    const lastLow = lows.at(-1) ?? 0;
    const trend = lastHigh > highs[0] && lastLow > lows[0] ? 'uptrend' : lastHigh < highs[0] && lastLow < lows[0] ? 'downtrend' : 'sideways';
    return { trend, highs, lows };
  }

  private calculateBreakOfStructure(candles: Candle[]): { lastBreak: number | null } {
    if (candles.length < 2) {
      return { lastBreak: null };
    }
    const last = candles.at(-1)!;
    const prev = candles[candles.length - 2];
    const breakValue = last.high > prev.high || last.low < prev.low ? last.close : null;
    return { lastBreak: breakValue };
  }

  private calculateChangeOfCharacter(candles: Candle[]): { value: string } {
    if (candles.length < 3) {
      return { value: 'neutral' };
    }
    const prev = candles[candles.length - 2];
    const last = candles.at(-1)!;
    const value = last.close > prev.close && last.volume > prev.volume ? 'bullish' : last.close < prev.close && last.volume > prev.volume ? 'bearish' : 'neutral';
    return { value };
  }

  private emaSeries(values: number[], period: number): number[] {
    if (!values.length) {
      return [];
    }
    const multiplier = 2 / (period + 1);
    const initialSma = values.slice(0, Math.min(period, values.length)).reduce((sum, value) => sum + value, 0) / Math.min(period, values.length);
    const emaValues: number[] = [];
    values.forEach((value, index) => {
      if (index === 0) {
        emaValues.push(initialSma);
      } else {
        emaValues.push(value * multiplier + emaValues[index - 1] * (1 - multiplier));
      }
    });
    return emaValues;
  }
}
