import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BinanceMarketDataService } from './binance-market-data.service';
import { CanonicalMarketState } from '../interfaces/canonical-market.interface';
import { MarketObservabilityService } from './market-observability.service';

@Injectable()
export class RecoverySchedulerService implements OnModuleDestroy {
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private readonly attempts = new Map<string, number>();
  private readonly listener: ({ state }: { state: CanonicalMarketState }) => void;

  constructor(
    events: EventEmitter2,
    private readonly marketData: BinanceMarketDataService,
    private readonly metrics: MarketObservabilityService,
  ) {
    this.listener = ({ state }) => {
      if (!state.orderBook?.sequenceHealthy) this.scheduleOrderBook(state);
      if (state.dataQuality.reasons.includes('CANDLE_GAP')) this.scheduleCandle(state);
    };
    events.on('market.canonical.updated', this.listener);
  }

  onModuleDestroy(): void {
    for (const timer of this.pending.values()) clearTimeout(timer);
    this.pending.clear();
  }

  private scheduleOrderBook(state: CanonicalMarketState): void {
    this.schedule(`book:${state.marketType}:${state.symbol}`, 1_000, async () => {
      this.metrics.increment('resyncAttempts');
      await this.marketData.recoverOrderBook(state.symbol, state.marketType, 1);
      this.metrics.increment('resyncSuccess');
    });
  }

  private scheduleCandle(state: CanonicalMarketState): void {
    const timeframe = state.timeframes['1m'] ? '1m' : '5m';
    this.schedule(`candle:${state.marketType}:${state.symbol}:${timeframe}`, 2_000, async () => {
      await this.marketData.backfillCandles(state.symbol, state.marketType, timeframe);
      this.metrics.increment('candleBackfills');
    });
  }

  private schedule(key: string, delay: number, task: () => Promise<void>): void {
    if (this.pending.has(key)) return;
    const attempt = this.attempts.get(key) ?? 0;
    if (attempt >= 3) return;
    const timer = setTimeout(() => {
      this.pending.delete(key);
      this.attempts.set(key, attempt + 1);
      void task().then(
        () => this.attempts.delete(key),
        () => {
          if ((this.attempts.get(key) ?? 0) >= 3) {
            this.attempts.delete(key);
            if (key.startsWith('book:')) this.metrics.increment('resyncFailures');
            if (key.startsWith('candle:')) this.metrics.increment('candleBackfillFailures');
            return;
          }
          if (key.startsWith('book:')) this.metrics.increment('resyncFailures');
          if (key.startsWith('candle:')) this.metrics.increment('candleBackfillFailures');
          this.schedule(key, delay, task);
        },
      );
    }, Math.min(30_000, delay * 2 ** attempt));
    this.pending.set(key, timer);
  }
}
