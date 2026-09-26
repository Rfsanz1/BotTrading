import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { BaseCollector } from './base.collector';
import { MarketSnapshot } from '../interfaces/market-data.interface';
import { BinanceMarketClient } from './binance-market-client';

@Injectable()
export class FundingRateCollector extends BaseCollector {
  constructor(eventEmitter: EventEmitter2, private readonly client: BinanceMarketClient = new BinanceMarketClient()) {
    super(eventEmitter);
    this.source = 'funding-rate';
  }

  async collect(symbol: string, timeframe: string): Promise<MarketSnapshot> {
    const funding = await this.withRetry(() => this.client.funding(symbol));
    const snapshot: MarketSnapshot = {
      symbol,
      timeframe,
      source: this.source,
      payload: { provider: 'binance-usdm', symbol, timeframe, funding },
      normalized: { fundingRate: funding.fundingRate, timestamp: funding.fundingTime },
      createdAt: new Date(),
      fetchedAt: new Date(),
    };
    this.emitSnapshot(snapshot);
    return snapshot;
  }
}
