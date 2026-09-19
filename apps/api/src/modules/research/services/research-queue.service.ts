import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { ResearchService } from './research.service';

@Injectable()
export class ResearchQueueService {
  private readonly logger = new Logger(ResearchQueueService.name);

  constructor(
    private readonly researchService: ResearchService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  async enqueue(symbol: string, timeframe: string, exchange: string): Promise<void> {
    this.logger.log(`Research queued for ${symbol}/${timeframe}/${exchange}`);
    await this.researchService.runResearch(symbol, timeframe, exchange);
    await this.eventEmitter.emitAsync('research.queued', { symbol, timeframe, exchange });
  }
}
