import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  CanonicalCandle,
  CanonicalMarketState,
  CanonicalMarketType,
  CanonicalTimeframe,
  TimeframeFeatureState,
} from '../interfaces/canonical-market.interface';
import { DataQualityService } from './data-quality.service';
import { LocalOrderBookEngine, OrderBookState } from './local-order-book.engine';
import { TradeFlowService } from './trade-flow.service';
import { LiquidationService } from './liquidation.service';
import { MarketStructureService } from './market-structure.service';
import { FuturesIntelligenceService } from './futures-intelligence.service';

const TIMEFRAMES: CanonicalTimeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
const INTERVAL_MS: Record<CanonicalTimeframe, number> = {
  '1m': 60_000,
  '5m': 300_000,
  '15m': 900_000,
  '1h': 3_600_000,
  '4h': 14_400_000,
  '1d': 86_400_000,
};

@Injectable()
export class CanonicalMarketCacheService {
  private readonly states = new Map<string, CanonicalMarketState>();
  private readonly books = new Map<string, LocalOrderBookEngine>();

  constructor(
    private readonly tradeFlow: TradeFlowService,
    private readonly quality: DataQualityService,
    private readonly events: EventEmitter2,
    private readonly liquidation: LiquidationService,
    private readonly structure: MarketStructureService = new MarketStructureService(),
    private readonly futuresIntelligence: FuturesIntelligenceService = new FuturesIntelligenceService(),
  ) {}

  get(symbol: string, marketType: CanonicalMarketType): CanonicalMarketState | undefined {
    return this.states.get(this.key(symbol, marketType));
  }

  list(): CanonicalMarketState[] {
    return [...this.states.values()];
  }

  backfillCandles(
    symbol: string,
    marketType: CanonicalMarketType,
    timeframe: CanonicalTimeframe,
    candles: CanonicalCandle[],
  ): CanonicalMarketState {
    const state = this.ensure(symbol, marketType);
    const merged = new Map<number, CanonicalCandle>();
    for (const candle of [...state.candles[timeframe], ...candles]) {
      if (!candle.closed || !Number.isFinite(candle.openTime)) continue;
      merged.set(candle.openTime, candle);
    }
    const ordered = [...merged.values()].sort((a, b) => a.openTime - b.openTime).slice(-500);
    state.candles[timeframe] = ordered;
    state.timeframes[timeframe] = this.features(ordered, timeframe, Date.now());
    state.structure[timeframe] = this.structure.analyze(
      state.symbol,
      timeframe,
      ordered.map((item) => ({
        timestamp: item.closeTime, high: item.high, low: item.low,
        open: item.open, close: item.close, volume: item.volume,
      })),
    );
    const last = ordered.at(-1);
    state.dataQuality = last
      ? this.quality.evaluate({ observedAt: last.closeTime, now: Date.now(), maxAgeMs: INTERVAL_MS[timeframe] * 2, sequenceHealthy: state.orderBook?.sequenceHealthy ?? true })
      : this.quality.evaluate({ required: true, maxAgeMs: 1 });
    this.publish(state, 'CANDLE_BACKFILL');
    return state;
  }

  hydrateFutures(
    symbol: string,
    input: {
      currentFundingRate?: number;
      fundingHistory?: number[];
      currentOpenInterest?: number;
      openInterestHistory?: number[];
      markPrice?: number;
      indexPrice?: number;
      lastPrice?: number;
    },
  ): CanonicalMarketState {
    const state = this.ensure(symbol, 'futures');
    const fundingHistory = input.fundingHistory?.filter(Number.isFinite).slice(-500) ?? state.futures.fundingHistory;
    const oiHistory = input.openInterestHistory?.filter(Number.isFinite).slice(-500) ?? state.futures.openInterestHistory;
    if (input.currentFundingRate !== undefined) {
      const current = input.currentFundingRate;
      const features = this.futuresIntelligence.fundingFeatures(fundingHistory, current);
      Object.assign(state.futures, {
        fundingRate: current,
        fundingHistory,
        fundingMean: features.mean,
        fundingStd: features.std,
        fundingZScore: features.zScore,
        fundingPercentile: features.percentile,
      });
    }
    if (input.currentOpenInterest !== undefined) {
      const current = input.currentOpenInterest;
      const features = this.futuresIntelligence.openInterestFeatures(oiHistory, current);
      Object.assign(state.futures, {
        openInterestContracts: current,
        openInterestHistory: oiHistory,
        openInterestDelta: features.delta,
        openInterestPctChange: features.pctChange,
        openInterestZScore: features.zScore,
        openInterestPercentile: features.percentile,
      });
    }
    if (input.markPrice !== undefined) state.futures.markPrice = input.markPrice;
    if (input.indexPrice !== undefined) state.futures.indexPrice = input.indexPrice;
    if (input.lastPrice !== undefined) state.futures.lastPrice = input.lastPrice;
    const last = state.futures.lastPrice ?? state.lastPrice;
    if ([last, state.futures.markPrice, state.futures.indexPrice].every((value) => Number.isFinite(value)) && state.futures.indexPrice !== 0) {
      const basis = this.futuresIntelligence.basis(last!, state.futures.markPrice!, state.futures.indexPrice!);
      state.futures.basis = basis.basis;
      state.futures.basisPct = basis.basisPct;
    }
    state.futures.lastUpdateAt = Date.now();
    this.publish(state, 'FUTURES_HYDRATED');
    return state;
  }

  initializeOrderBook(symbol: string, marketType: CanonicalMarketType, snapshot: {
    lastUpdateId: number;
    bids: Array<[number, number]>;
    asks: Array<[number, number]>;
  }): CanonicalMarketState {
    const state = this.ensure(symbol, marketType);
    const book = this.book(symbol, marketType);
    book.initialize(snapshot);
    state.orderBook = book.state();
    this.refreshQuality(state, Date.now(), true);
    this.publish(state, 'ORDER_BOOK_SNAPSHOT');
    return state;
  }

  handle(symbol: string, marketType: CanonicalMarketType, event: Record<string, unknown>): CanonicalMarketState | null {
    const eventType = String(event.e ?? event.eventType ?? '').toLowerCase();
    const eventSymbol = String(event.s ?? event.symbol ?? symbol).toUpperCase();
    if (eventSymbol !== symbol.toUpperCase()) return null;
    const state = this.ensure(symbol, marketType);
    const eventTime = this.eventTime(event);
    if (eventType === 'kline') this.handleKline(state, event, eventTime);
    else if (eventType === 'aggtrade' || eventType === 'trade') this.handleTrade(state, event, eventTime);
    else if (eventType === 'bookticker') this.handleTicker(state, event, eventTime);
    else if (eventType === 'depthupdate') this.handleDepth(state, event, eventTime);
    else if (eventType === 'markpriceupdate') this.handleMarkPrice(state, event, eventTime);
    else if (eventType === 'forceorder') this.handleLiquidation(state, event, eventTime);
    else return null;
    state.lastUpdate = eventTime;
    state.lastEventType = eventType;
    this.refreshQuality(state, eventTime, state.orderBook?.sequenceHealthy ?? true);
    this.publish(state, eventType.toUpperCase());
    return state;
  }

  private handleKline(state: CanonicalMarketState, event: Record<string, unknown>, eventTime: number): void {
    const kline = (event.k ?? {}) as Record<string, unknown>;
    const timeframe = this.normalizeTimeframe(String(kline.i ?? ''));
    if (!timeframe) return;
    const candle: CanonicalCandle = {
      openTime: this.number(kline.t, 'kline open time'),
      closeTime: this.number(kline.T, 'kline close time'),
      open: this.number(kline.o, 'kline open'),
      high: this.number(kline.h, 'kline high'),
      low: this.number(kline.l, 'kline low'),
      close: this.number(kline.c, 'kline close'),
      volume: this.number(kline.v, 'kline volume'),
      closed: kline.x === true,
    };
    if (candle.openTime > eventTime + 60_000) throw new Error('Future kline event rejected');
    if (!candle.closed) {
      state.formingCandles[timeframe] = candle;
      return;
    }
    const history = state.candles[timeframe];
    const previous = history.at(-1);
    if (previous?.openTime === candle.openTime) history[history.length - 1] = candle;
    else {
      if (previous && candle.openTime - previous.openTime > INTERVAL_MS[timeframe] * 1.5) {
        state.dataQuality = {
          state: 'DEGRADED',
          reasons: ['CANDLE_GAP'],
          ageMs: Math.max(0, eventTime - candle.closeTime),
        };
      }
      history.push(candle);
      if (history.length > 500) history.shift();
    }
    delete state.formingCandles[timeframe];
    state.timeframes[timeframe] = this.features(history, timeframe, eventTime);
    state.structure[timeframe] = this.structure.analyze(
      state.symbol,
      timeframe,
      history.map((item) => ({
        timestamp: item.closeTime,
        high: item.high,
        low: item.low,
        open: item.open,
        close: item.close,
        volume: item.volume,
      })),
    );
  }

  private handleTrade(state: CanonicalMarketState, event: Record<string, unknown>, eventTime: number): void {
    const price = this.number(event.p, 'trade price');
    const volume = this.number(event.q, 'trade quantity');
    state.lastPrice = price;
    state.tradeFlow = this.tradeFlow.record(this.key(state.symbol, state.marketType), price, volume, event.m === true, eventTime);
  }

  private handleTicker(state: CanonicalMarketState, event: Record<string, unknown>, eventTime: number): void {
    state.bid = this.number(event.b, 'best bid');
    state.ask = this.number(event.a, 'best ask');
    state.lastPrice = state.ask !== null && state.bid !== null ? (state.ask + state.bid) / 2 : state.lastPrice;
    state.mid = state.bid !== null && state.ask !== null ? (state.bid + state.ask) / 2 : null;
    state.dataQuality = this.quality.evaluate({ observedAt: eventTime, now: Date.now(), maxAgeMs: 10_000 });
  }

  private handleDepth(state: CanonicalMarketState, event: Record<string, unknown>, eventTime: number): void {
    const book = this.book(state.symbol, state.marketType);
    const update = {
      firstUpdateId: this.number(event.U, 'depth first update'),
      finalUpdateId: this.number(event.u, 'depth final update'),
      previousUpdateId: typeof event.pu === 'number' ? event.pu : undefined,
      eventTime,
      bids: this.levels(event.b),
      asks: this.levels(event.a),
    };
    if (!book.applyUpdate(update)) {
      state.dataQuality = this.quality.evaluate({
        observedAt: eventTime,
        now: Date.now(),
        maxAgeMs: 2_000,
        sequenceHealthy: false,
      });
    }
    state.orderBook = book.state();
  }

  private handleMarkPrice(state: CanonicalMarketState, event: Record<string, unknown>, eventTime: number): void {
    state.futures.markPrice = this.number(event.p, 'mark price');
    state.futures.indexPrice = this.number(event.i, 'index price');
    state.futures.lastUpdateAt = eventTime;
    state.lastPrice = state.futures.markPrice;
    state.futures.lastPrice = state.lastPrice;
    if (state.futures.indexPrice !== 0) {
      state.futures.basis = state.futures.lastPrice - state.futures.indexPrice;
      state.futures.basisPct = state.futures.basis / state.futures.indexPrice;
    }
  }

  private handleLiquidation(state: CanonicalMarketState, event: Record<string, unknown>, eventTime: number): void {
    const order = (event.o ?? {}) as Record<string, unknown>;
    const liquidation = this.liquidation.record({
      side: String(order.S ?? '').toUpperCase() === 'BUY' ? 'BUY' : 'SELL',
      quantity: this.number(order.q, 'liquidation quantity'),
      price: this.number(order.p, 'liquidation price'),
      timestamp: eventTime,
    });
    state.liquidation = liquidation;
    state.futures.lastUpdateAt = eventTime;
  }

  private ensure(symbol: string, marketType: CanonicalMarketType): CanonicalMarketState {
    const key = this.key(symbol, marketType);
    const existing = this.states.get(key);
    if (existing) return existing;
    const candles = TIMEFRAMES.reduce((result, timeframe) => {
      result[timeframe] = [];
      return result;
    }, {} as Record<CanonicalTimeframe, CanonicalCandle[]>);
    const state: CanonicalMarketState = {
      symbol: symbol.toUpperCase(),
      marketType,
      lastPrice: null,
      bid: null,
      ask: null,
      mid: null,
      candles,
      formingCandles: {},
      orderBook: null,
      tradeFlow: this.tradeFlow.createState(),
      futures: {
        markPrice: null, indexPrice: null, lastPrice: null, basis: null, basisPct: null,
        fundingRate: null, fundingHistory: [], fundingMean: null, fundingStd: null, fundingZScore: null, fundingPercentile: null,
        openInterestContracts: null, openInterestHistory: [], openInterestDelta: null, openInterestPctChange: null,
        openInterestZScore: null, openInterestPercentile: null, lastUpdateAt: null,
      },
      liquidation: { buyVolume: 0, sellVolume: 0, totalVolume: 0, imbalance: null, level: 'LIQUIDATION_NORMAL', zScore: null, lastLiquidationTime: null },
      structure: {},
      timeframes: {},
      dataQuality: this.quality.evaluate({ maxAgeMs: 1, required: true }),
      lastUpdate: null,
      lastEventType: null,
    };
    this.states.set(key, state);
    return state;
  }

  private book(symbol: string, marketType: CanonicalMarketType): LocalOrderBookEngine {
    const key = this.key(symbol, marketType);
    const existing = this.books.get(key);
    if (existing) return existing;
    const book = new LocalOrderBookEngine();
    this.books.set(key, book);
    return book;
  }

  private publish(state: CanonicalMarketState, eventType: string): void {
    this.events.emit('market.canonical.updated', { eventType, state });
  }

  private refreshQuality(state: CanonicalMarketState, eventTime: number, sequenceHealthy: boolean): void {
    if (state.dataQuality.state === 'DEGRADED' && state.dataQuality.reasons.includes('CANDLE_GAP')) return;
    state.dataQuality = this.quality.evaluate({
      observedAt: eventTime,
      now: Date.now(),
      maxAgeMs: state.orderBook ? 30_000 : 60_000,
      sequenceHealthy,
    });
  }

  private features(history: CanonicalCandle[], timeframe: CanonicalTimeframe, updatedAt: number): TimeframeFeatureState {
    if (history.length < 2) return { trend: 'NEUTRAL', momentum: null, volatility: null, structure: 'UNKNOWN', volume: history.at(-1)?.volume ?? null, updatedAt };
    const last = history.at(-1)!;
    const previous = history.at(-2)!;
    const momentum = (last.close - previous.close) / previous.close;
    const trend = momentum > 0 ? 'BULLISH' : momentum < 0 ? 'BEARISH' : 'NEUTRAL';
    return {
      trend,
      momentum,
      volatility: (last.high - last.low) / last.close,
      structure: last.close > previous.high ? 'BULLISH' : last.close < previous.low ? 'BEARISH' : 'RANGE',
      volume: last.volume,
      updatedAt,
    };
  }

  private levels(value: unknown): Array<[number, number]> {
    if (!Array.isArray(value)) throw new Error('Invalid depth levels');
    return value.map((level) => {
      if (!Array.isArray(level) || level.length < 2) throw new Error('Invalid depth level');
      return [this.number(level[0], 'depth price'), this.number(level[1], 'depth quantity')];
    });
  }

  private eventTime(event: Record<string, unknown>): number {
    const value = event.E ?? event.T;
    return this.number(value, 'event time');
  }

  private normalizeTimeframe(value: string): CanonicalTimeframe | null {
    const normalized = value.toLowerCase();
    return (['1m', '5m', '15m', '1h', '4h', '1d'] as CanonicalTimeframe[]).includes(normalized as CanonicalTimeframe)
      ? normalized as CanonicalTimeframe : null;
  }

  private number(value: unknown, field: string): number {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) throw new Error(`Invalid ${field}`);
    return parsed;
  }

  private key(symbol: string, marketType: CanonicalMarketType): string {
    return `${marketType}:${symbol.toUpperCase()}`;
  }
}
