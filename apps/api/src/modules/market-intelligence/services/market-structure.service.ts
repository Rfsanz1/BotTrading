import { Injectable } from '@nestjs/common';

export type StructureEventType = 'SWING_HIGH' | 'SWING_LOW' | 'HH' | 'HL' | 'LH' | 'LL' | 'BOS' | 'CHoCH' | 'MSS' | 'LIQUIDITY_SWEEP' | 'FVG' | 'ORDER_BLOCK';
export type StructureDirection = 'BULLISH' | 'BEARISH' | 'NEUTRAL';

export interface StructureEvent {
  symbol: string;
  timeframe: string;
  type: StructureEventType;
  direction: StructureDirection;
  timestamp: number;
  price: number;
  zone?: { low: number; high: number };
  strength: number;
  invalidation: number | null;
  sourceCandleIndices: number[];
}

export interface StructureState {
  trend: 'BULLISH' | 'BEARISH' | 'RANGE' | 'UNKNOWN';
  protectedHigh: number | null;
  protectedLow: number | null;
  events: StructureEvent[];
}

interface Candle {
  timestamp: number;
  high: number;
  low: number;
  open: number;
  close: number;
  volume: number;
}

@Injectable()
export class MarketStructureService {
  analyze(symbol: string, timeframe: string, candles: Candle[], leftRight = 2): StructureState {
    if (candles.length < leftRight * 2 + 3) return { trend: 'UNKNOWN', protectedHigh: null, protectedLow: null, events: [] };
    const events: StructureEvent[] = [];
    const highs: Array<{ index: number; price: number }> = [];
    const lows: Array<{ index: number; price: number }> = [];
    for (let index = leftRight; index < candles.length - leftRight; index += 1) {
      const candle = candles[index];
      const left = candles.slice(index - leftRight, index);
      const right = candles.slice(index + 1, index + leftRight + 1);
      if (left.every((item) => candle.high > item.high) && right.every((item) => candle.high > item.high)) {
        highs.push({ index, price: candle.high });
        events.push(this.event(symbol, timeframe, 'SWING_HIGH', 'BEARISH', candles, index, candle.high, candle.low));
      }
      if (left.every((item) => candle.low < item.low) && right.every((item) => candle.low < item.low)) {
        lows.push({ index, price: candle.low });
        events.push(this.event(symbol, timeframe, 'SWING_LOW', 'BULLISH', candles, index, candle.low, candle.high));
      }
    }
    this.classifySwings(symbol, timeframe, candles, highs, 'HIGH', events);
    this.classifySwings(symbol, timeframe, candles, lows, 'LOW', events);
    for (let index = 1; index < events.length; index += 1) {
      const event = events[index];
      const previous = events[index - 1];
      if ((event.type === 'SWING_HIGH' || event.type === 'SWING_LOW') && previous.direction !== event.direction) continue;
      if (event.type === 'SWING_HIGH' && candles.at(-1)!.close > event.price) {
        events.push(this.event(symbol, timeframe, 'BOS', 'BULLISH', candles, candles.length - 1, event.price, event.price));
      }
      if (event.type === 'SWING_LOW' && candles.at(-1)!.close < event.price) {
        events.push(this.event(symbol, timeframe, 'BOS', 'BEARISH', candles, candles.length - 1, event.price, event.price));
      }
    }
    this.detectGapsAndBlocks(symbol, timeframe, candles, events);
    const lastHigh = highs.at(-1)?.price ?? null;
    const lastLow = lows.at(-1)?.price ?? null;
    const lastClose = candles.at(-1)!.close;
    return {
      trend: lastHigh !== null && lastLow !== null
        ? lastClose > lastHigh ? 'BULLISH' : lastClose < lastLow ? 'BEARISH' : 'RANGE'
        : 'UNKNOWN',
      protectedHigh: lastHigh,
      protectedLow: lastLow,
      events: events.sort((a, b) => a.timestamp - b.timestamp),
    };
  }

  private classifySwings(symbol: string, timeframe: string, candles: Candle[], swings: Array<{ index: number; price: number }>, kind: 'HIGH' | 'LOW', events: StructureEvent[]): void {
    for (let index = 1; index < swings.length; index += 1) {
      const current = swings[index];
      const previous = swings[index - 1];
      const higher = current.price > previous.price;
      const type = kind === 'HIGH' ? higher ? 'HH' : 'LH' : higher ? 'HL' : 'LL';
      events.push(this.event(symbol, timeframe, type, type === 'HH' || type === 'HL' ? 'BULLISH' : 'BEARISH', candles, current.index, current.price, kind === 'HIGH' ? candles[current.index].low : candles[current.index].high));
    }
  }

  private detectGapsAndBlocks(symbol: string, timeframe: string, candles: Candle[], events: StructureEvent[]): void {
    for (let index = 2; index < candles.length; index += 1) {
      const previous = candles[index - 2];
      const current = candles[index];
      if (current.low > previous.high) {
        events.push(this.event(symbol, timeframe, 'FVG', 'BULLISH', candles, index, current.low, previous.high, { low: previous.high, high: current.low }));
      } else if (current.high < previous.low) {
        events.push(this.event(symbol, timeframe, 'FVG', 'BEARISH', candles, index, current.high, previous.low, { low: current.high, high: previous.low }));
      }
      const body = Math.abs(current.close - current.open);
      const range = current.high - current.low;
      if (range > 0 && body / range >= 0.7 && index > 0) {
        const origin = candles[index - 1];
        events.push(this.event(symbol, timeframe, 'ORDER_BLOCK', current.close > current.open ? 'BULLISH' : 'BEARISH', candles, index, origin.close, current.close, { low: origin.low, high: origin.high }));
      }
    }
  }

  private event(symbol: string, timeframe: string, type: StructureEventType, direction: StructureDirection, candles: Candle[], index: number, price: number, invalidation: number, zone?: { low: number; high: number }): StructureEvent {
    const confirmation = Math.min(candles.length - 1, index + 2);
    return {
      symbol,
      timeframe,
      type,
      direction,
      timestamp: candles[confirmation].timestamp,
      price,
      zone,
      strength: Math.min(1, Math.abs(candles[index].close - candles[index].open) / Math.max(candles[index].high - candles[index].low, Number.EPSILON)),
      invalidation,
      sourceCandleIndices: zone ? [index - 1, index] : [index],
    };
  }
}
