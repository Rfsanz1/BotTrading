import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { ResearchQueueService } from './research-queue.service';

@Injectable()
export class ResearchSchedulerService {
  private readonly logger = new Logger(ResearchSchedulerService.name);

  constructor(private readonly queue: ResearchQueueService) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async runResearchCycle(): Promise<void> {
    this.logger.log('Running scheduled research cycle');
    await this.queue.enqueue('BTC/USDT', '1H', 'binance');
    await this.queue.enqueue('ETH/USDT', '1H', 'binance');
  }
}
