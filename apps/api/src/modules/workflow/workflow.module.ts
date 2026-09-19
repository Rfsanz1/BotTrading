import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { WorkflowService } from './workflow.service';
import { AlertService } from '../alerts/services/alert.service';
import { AnalysisService } from '../analysis/services/analysis.service';
import { ConsensusService } from '../consensus/consensus.service';
import { RecommendationService } from '../recommendations/recommendation.service';
import { NotificationService } from '../notifications/notification.service';
import { MarketService } from '../market/market.service';
import { AlertRepository } from '../alerts/repositories/alert.repository';
import { AnalysisRepository } from '../analysis/repositories/analysis.repository';

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [
    WorkflowService,
    AlertService,
    AnalysisService,
    ConsensusService,
    RecommendationService,
    NotificationService,
    MarketService,
    AlertRepository,
    AnalysisRepository,
  ],
  exports: [WorkflowService],
})
export class WorkflowModule {}
