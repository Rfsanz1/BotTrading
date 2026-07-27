import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { MarketCollector, CollectorConfig, MarketSnapshot } from '../interfaces/market-data.interface';

@Injectable()
export abstract class BaseCollector implements MarketCollector {
  protected readonly logger = new Logger(this.constructor.name);
  public readonly name: string;
  public readonly source: string;

  protected config: CollectorConfig;
  protected running = false;

  constructor(protected readonly eventEmitter: EventEmitter2) {
    this.name = this.constructor.name;
    this.source = this.constructor.name;
    this.config = {
      enabled: true,
      intervalMs: 15000,
      retries: 3,
      timeoutMs: 5000,
      symbols: ['BTC/USDT'],
      timeframes: ['1m', '5m', '1H'],
    };
  }

  async start(): Promise<void> {
    this.running = true;
    this.logger.log(`Collector started: ${this.name}`);
  }

  async stop(): Promise<void> {
    this.running = false;
    this.logger.log(`Collector stopped: ${this.name}`);
  }

  protected async withRetry<T>(operation: () => Promise<T>): Promise<T> {
    let attempt = 0;
    while (attempt < this.config.retries) {
      try {
        return await operation();
      } catch (error) {
        attempt += 1;
        if (attempt >= this.config.retries) throw error;
        this.logger.warn(`${this.name} retry ${attempt}/${this.config.retries}`);
        await new Promise((resolve) => setTimeout(resolve, 1000 * attempt));
      }
    }
    throw new Error('Retry exhausted');
  }

  protected emitSnapshot(snapshot: MarketSnapshot): void {
    this.eventEmitter.emit('market.collected', snapshot);
  }

  abstract collect(symbol: string, timeframe: string): Promise<MarketSnapshot>;
}
