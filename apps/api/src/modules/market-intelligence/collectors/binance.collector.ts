import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BaseCollector } from './base.collector';
import { MarketSnapshot } from '../interfaces/market-data.interface';
import { BinanceMarketClient } from './binance-market-client';

@Injectable()
export class BinanceCollector extends BaseCollector {
  constructor(eventEmitter: EventEmitter2, private readonly client: BinanceMarketClient = new BinanceMarketClient()) {
    super(eventEmitter);
    this.source = 'binance';
  }

  async collect(symbol: string, timeframe: string): Promise<MarketSnapshot> {
    const klines = await this.withRetry(() => this.client.klines(symbol, timeframe, 200));
    const latest = klines.at(-1);
    if (!latest) throw new Error(`Binance returned no klines for ${symbol}/${timeframe}`);
    const snapshot: MarketSnapshot = {
      symbol,
      timeframe,
      source: this.source,
      payload: { provider: 'binance', symbol, timeframe, klines },
      normalized: {
        price: latest.close,
        open: latest.open,
        high: latest.high,
        low: latest.low,
        volume: latest.volume,
        timestamp: latest.closeTime,
        isClosed: latest.closeTime < Date.now(),
      },
      createdAt: new Date(),
      fetchedAt: new Date(),
    };
    this.emitSnapshot(snapshot);
    return snapshot;
  }
}
