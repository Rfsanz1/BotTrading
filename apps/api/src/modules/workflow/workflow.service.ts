import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { AlertService } from '../alerts/services/alert.service';
import { AnalysisService } from '../analysis/services/analysis.service';
import { ConsensusService } from '../consensus/consensus.service';
import { RecommendationService } from '../recommendations/recommendation.service';
import { NotificationService } from '../notifications/notification.service';
import { MarketService } from '../market/market.service';

@Injectable()
export class WorkflowService implements OnModuleInit {
  private readonly logger = new Logger(WorkflowService.name);

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly alertService: AlertService,
    private readonly analysisService: AnalysisService,
    private readonly consensusService: ConsensusService,
    private readonly recommendationService: RecommendationService,
    private readonly notificationService: NotificationService,
    private readonly marketService: MarketService,
  ) {}

  onModuleInit() {
    this.logger.log('WorkflowService initialized and ready to handle events');
  }

  @OnEvent('trading.alert.received')
  async onAlertReceived(payload: any) {
    try {
      const event = payload as any;
      const alertId = event.alertId || payload.id;
      const userId = event.userId || 'system';
      const symbol = event.symbol;

      this.logger.log(`Orchestrator: Alert received ${alertId} for ${symbol}`);

      // Validate alert
      await this.alertService.validateAlert(alertId);
      await this.alertService.startProcessing(alertId);

      // Fetch market data
      const marketData = await this.marketService.fetchMarketData(symbol);

      // Run analysis
      await this.analysisService.analyzeAlert(alertId, userId, symbol, marketData);

      // Get analyses and build consensus
      const analyses = await this.analysisService.getAnalysisResults(alertId);
      const consensus = await this.consensusService.buildConsensus(alertId, userId, symbol, analyses);

      // Generate recommendation
      const recommendationId = await this.recommendationService.generate({
        alertId,
        userId,
        symbol,
        consensusRecommendation: consensus.recommendation,
        confidenceScore: Number(consensus.confidenceScore),
        riskScore: Number(consensus.riskScore),
        currentPrice: marketData.currentPrice || 0,
      });

      // Fetch recommendation and notify user
      const recommendation = await this.recommendationService.getRecommendation(recommendationId);
      await this.notificationService.sendRecommendationAlert(userId, recommendation);

      this.logger.log(`Orchestrator: Completed processing for alert ${alertId}`);
    } catch (error) {
      this.logger.error(`Orchestrator failed: ${error.message}`);
    }
  }
}
