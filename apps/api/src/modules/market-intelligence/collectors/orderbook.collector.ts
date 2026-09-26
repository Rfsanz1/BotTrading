import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BaseCollector } from './base.collector';
import { MarketSnapshot } from '../interfaces/market-data.interface';
import { BinanceMarketClient } from './binance-market-client';

@Injectable()
export class OrderBookCollector extends BaseCollector {
  constructor(eventEmitter: EventEmitter2, private readonly client: BinanceMarketClient = new BinanceMarketClient()) {
    super(eventEmitter);
    this.source = 'orderbook';
  }

  async collect(symbol: string, timeframe: string): Promise<MarketSnapshot> {
    const orderBook = await this.withRetry(() => this.client.orderBook(symbol));
    const bestBid = orderBook.bids[0]?.[0];
    const bestAsk = orderBook.asks[0]?.[0];
    if (bestBid === undefined || bestAsk === undefined) throw new Error(`Binance returned an incomplete order book for ${symbol}`);
    const snapshot: MarketSnapshot = {
      symbol,
      timeframe,
      source: this.source,
      payload: { provider: 'binance-spot', symbol, timeframe, orderBook },
      normalized: {
        bids: orderBook.bids,
        asks: orderBook.asks,
        bestBid,
        bestAsk,
        spread: bestAsk - bestBid,
        spreadBps: ((bestAsk - bestBid) / ((bestAsk + bestBid) / 2)) * 10_000,
        lastUpdateId: orderBook.lastUpdateId,
        timestamp: Date.now(),
      },
      createdAt: new Date(),
      fetchedAt: new Date(),
    };
    this.emitSnapshot(snapshot);
    return snapshot;
  }
}
