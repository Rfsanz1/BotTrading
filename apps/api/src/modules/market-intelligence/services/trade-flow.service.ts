import { Injectable } from '@nestjs/common';

export interface TradeFlowState {
  tradeCount: number;
  buyVolume: number;
  sellVolume: number;
  takerDelta: number;
  takerBuySellRatio: number | null;
  cvd: number;
  cvdByWindow: Record<'1m' | '5m' | '15m' | '1h', number>;
  cvdSlope: number | null;
  cvdAcceleration: number | null;
  largeTradeCount: number;
  largeTradeVolume: number;
  priceCvdDivergence: 'BULLISH' | 'BEARISH' | 'NONE';
  volumeCvdDivergence: 'BULLISH' | 'BEARISH' | 'NONE';
  oiCvdDivergence: 'BULLISH' | 'BEARISH' | 'NONE';
  updatedAt: number | null;
}

interface TradePoint {
  timestamp: number;
  price: number;
  volume: number;
  signedVolume: number;
  isLarge: boolean;
}

@Injectable()
export class TradeFlowService {
  private readonly points = new Map<string, TradePoint[]>();
  private readonly largeTradeHistory = new Map<string, number[]>();

  createState(): TradeFlowState {
    return {
      tradeCount: 0,
      buyVolume: 0,
      sellVolume: 0,
      takerDelta: 0,
      takerBuySellRatio: null,
      cvd: 0,
      cvdByWindow: { '1m': 0, '5m': 0, '15m': 0, '1h': 0 },
      cvdSlope: null,
      cvdAcceleration: null,
      largeTradeCount: 0,
      largeTradeVolume: 0,
      priceCvdDivergence: 'NONE',
      volumeCvdDivergence: 'NONE',
      oiCvdDivergence: 'NONE',
      updatedAt: null,
    };
  }

  record(symbolKey: string, price: number, volume: number, buyerIsMaker: boolean, timestamp: number): TradeFlowState {
    if (![price, volume, timestamp].every(Number.isFinite) || price <= 0 || volume <= 0) {
      throw new Error('Invalid trade event');
    }
    const points = this.points.get(symbolKey) ?? [];
    const history = this.largeTradeHistory.get(symbolKey) ?? [];
    const percentileThreshold = this.percentile(history, 0.95);
    const isLarge = history.length >= 20 && volume >= percentileThreshold;
    history.push(volume);
    if (history.length > 500) history.shift();
    const signedVolume = buyerIsMaker ? -volume : volume;
    points.push({ timestamp, price, volume, signedVolume, isLarge });
    const cutoff = timestamp - 60 * 60 * 1000;
    while (points.length && points[0].timestamp < cutoff) points.shift();
    this.points.set(symbolKey, points);
    this.largeTradeHistory.set(symbolKey, history);
    return this.snapshot(points, timestamp);
  }

  setOivCvdDivergence(state: TradeFlowState, oiDelta: number | null): TradeFlowState {
    if (oiDelta === null || state.cvdSlope === null) return state;
    const divergence = oiDelta > 0 && state.cvdSlope < 0 ? 'BEARISH'
      : oiDelta < 0 && state.cvdSlope > 0 ? 'BULLISH' : 'NONE';
    return { ...state, oiCvdDivergence: divergence };
  }

  private snapshot(points: TradePoint[], now: number): TradeFlowState {
    const last = points.at(-1);
    const previous = points.at(-2);
    const window = (duration: number) => points.filter((point) => point.timestamp >= now - duration);
    const oneHour = window(60 * 60 * 1000);
    const cvd = oneHour.reduce((sum, point) => sum + point.signedVolume, 0);
    const cvdByWindow = {
      '1m': window(60_000).reduce((sum, point) => sum + point.signedVolume, 0),
      '5m': window(300_000).reduce((sum, point) => sum + point.signedVolume, 0),
      '15m': window(900_000).reduce((sum, point) => sum + point.signedVolume, 0),
      '1h': cvd,
    };
    const previousCvd = previous ? points.filter((point) => point.timestamp < previous.timestamp)
      .slice(-50).reduce((sum, point) => sum + point.signedVolume, 0) : null;
    const slope = previousCvd === null ? null : cvd - previousCvd;
    const previousSlope = points.length > 3
      ? points.slice(0, -2).slice(-50).reduce((sum, point) => sum + point.signedVolume, 0)
        - points.slice(0, -3).slice(-50).reduce((sum, point) => sum + point.signedVolume, 0)
      : null;
    const totalBuy = oneHour.filter((point) => point.signedVolume > 0).reduce((sum, point) => sum + point.signedVolume, 0);
    const totalSell = oneHour.filter((point) => point.signedVolume < 0).reduce((sum, point) => sum + Math.abs(point.signedVolume), 0);
    const priceChange = points.length > 1 ? last!.price - points[0].price : 0;
    const priceCvdDivergence = priceChange > 0 && (slope ?? 0) < 0 ? 'BEARISH'
      : priceChange < 0 && (slope ?? 0) > 0 ? 'BULLISH' : 'NONE';
    return {
      tradeCount: oneHour.length,
      buyVolume: totalBuy,
      sellVolume: totalSell,
      takerDelta: totalBuy - totalSell,
      takerBuySellRatio: totalSell === 0 ? (totalBuy > 0 ? null : 1) : totalBuy / totalSell,
      cvd,
      cvdByWindow,
      cvdSlope: slope,
      cvdAcceleration: slope !== null && previousSlope !== null ? slope - previousSlope : null,
      largeTradeCount: oneHour.filter((point) => point.isLarge).length,
      largeTradeVolume: oneHour.filter((point) => point.isLarge).reduce((sum, point) => sum + point.volume, 0),
      priceCvdDivergence,
      volumeCvdDivergence: totalBuy + totalSell > 0 && slope !== null && totalBuy + totalSell < oneHour.length
        ? 'BEARISH' : 'NONE',
      oiCvdDivergence: 'NONE',
      updatedAt: now,
    };
  }

  private percentile(values: number[], percentile: number): number {
    if (values.length === 0) return Number.POSITIVE_INFINITY;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percentile))];
  }
}
