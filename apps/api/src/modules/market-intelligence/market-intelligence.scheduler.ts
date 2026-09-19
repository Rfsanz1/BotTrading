import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MarketSyncService } from './services/market-sync.service';

@Injectable()
export class MarketIntelligenceScheduler {
  private readonly logger = new Logger(MarketIntelligenceScheduler.name);

  constructor(private readonly syncService: MarketSyncService) {}

  @Cron(CronExpression.EVERY_30_SECONDS)
  async syncMarketData(): Promise<void> {
    this.logger.log('Executing scheduled market intelligence sync');

    try {
      await this.syncService.sync(['BTC/USDT', 'ETH/USDT'], ['1m', '5m', '1H']);
    } catch (error) {
      this.logger.error('Scheduled market intelligence sync failed', error instanceof Error ? error.stack : error);
    }
  }
}
