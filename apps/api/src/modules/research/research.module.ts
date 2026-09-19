import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ResearchController } from './research.controller';
import { ResearchGateway } from './research.gateway';
import { ResearchService } from './services/research.service';
import { ResearchQueueService } from './services/research-queue.service';
import { ResearchSchedulerService } from './services/research-scheduler.service';
import { ResearchRepository } from './repositories/research.repository';
import { ResearchCacheService } from './services/research-cache.service';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';

@Module({
  imports: [EventEmitterModule.forRoot()],
  controllers: [ResearchController],
  providers: [
    PrismaService,
    RedisService,
    ResearchRepository,
    ResearchCacheService,
    ResearchService,
    ResearchQueueService,
    ResearchSchedulerService,
    ResearchGateway,
  ],
  exports: [ResearchService, ResearchQueueService],
})
export class ResearchModule {}
