import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CanonicalMarketState } from '../interfaces/canonical-market.interface';
import { MultiTimeframeService } from './multi-timeframe.service';
import { OpportunityService } from './opportunity.service';
import { RegimeService } from './regime.service';
import { TradingDecisionPipelineService } from './trading-decision-pipeline.service';
import { MarketObservabilityService } from './market-observability.service';
import { AnalysisService } from '../../analysis/services/analysis.service';
import { CalibrationService } from './calibration.service';

@Injectable()
export class MarketAnalysisService {
  private readonly logger = new Logger(MarketAnalysisService.name);

  constructor(
    events: EventEmitter2,
    private readonly multiTimeframe: MultiTimeframeService,
    private readonly regime: RegimeService,
    private readonly opportunity: OpportunityService,
    private readonly pipeline: TradingDecisionPipelineService,
    private readonly metrics: MarketObservabilityService,
    private readonly ai: AnalysisService,
    private readonly calibration: CalibrationService,
  ) {
    events.on('market.canonical.updated', ({ state }: { state: CanonicalMarketState }) => {
      void this.analyze(state, events);
    });
  }

  async analyze(state: CanonicalMarketState, events?: EventEmitter2): Promise<void> {
    const alignment = this.multiTimeframe.align(state.timeframes);
    const regime = this.regime.evaluate(state, alignment, state.structure[alignment.entryTimeframe]);
    const opportunity = this.opportunity.evaluate(state, alignment, regime, state.structure[alignment.entryTimeframe]);
    let aiOutput: unknown;
    const decisionTimestamp = Date.now();
    let calibrationState: 'CALIBRATION_READY' | 'CALIBRATION_COLD_START' | 'CALIBRATION_UNAVAILABLE' = 'CALIBRATION_UNAVAILABLE';
    let calibratedProbability: number | null = null;
    let calibrationSampleSize = 0;
    let calibrationMethod: string | undefined;
    let calibrationVersion: string | undefined;
    if (opportunity.decision === 'LONG_SETUP' || opportunity.decision === 'SHORT_SETUP') {
      const result = await this.ai.validateCandidate(state.symbol, {
        state, setupType: opportunity.setupType, regime, opportunity,
      }, decisionTimestamp);
      aiOutput = result.state === 'AI_VALID' ? result.value : result;
      this.metrics.increment('aiCalls');
      if (result.state === 'AI_VALID') this.metrics.increment('aiSuccesses');
      else if (result.state === 'AI_INVALID') this.metrics.increment('aiInvalid');
      else if (result.state === 'AI_AUTH_ERROR') this.metrics.increment('aiAuthErrors');
      else if (result.state === 'AI_RATE_LIMITED') this.metrics.increment('aiRateLimited');
      else if (result.state === 'AI_SERVER_ERROR') this.metrics.increment('aiServerErrors');
      else this.metrics.increment('aiUnavailable');
      if (result.state !== 'AI_VALID') this.logger.warn(`AI candidate validation ${result.state}: symbol=${state.symbol} reason=${result.reason}`);
      if (result.state === 'AI_VALID') {
        const calibration = await this.calibration.calibrate(result.value.confidenceRaw, decisionTimestamp);
        calibrationState = calibration.state;
        calibratedProbability = calibration.calibratedProbability;
        calibrationSampleSize = calibration.sampleSize;
        calibrationMethod = calibration.method;
        calibrationVersion = calibration.version;
        this.metrics.set('calibrationSampleSize', calibration.sampleSize);
      }
    }
    const decision = this.pipeline.evaluate(state, {
      aiOutput,
      decisionTimestamp,
      calibrationState,
      calibrationSampleSize,
      calibrationMethod,
      calibrationVersion,
      calibratedProbability,
    });
    if (opportunity.decision === 'LONG_SETUP' || opportunity.decision === 'SHORT_SETUP') {
      const reason = decision.authorizationReason
        ?? (decision.finalStatus === 'AUTHORIZED_FOR_PAPER' ? 'AUTHORIZED_FOR_PAPER' : decision.reasons[0] ?? 'OTHER');
      this.metrics.recordAuthorization(reason, decision.finalStatus === 'AUTHORIZED_FOR_PAPER');
      if (decision.calibrationState === 'CALIBRATION_COLD_START') this.metrics.increment('calibrationColdStart');
    }
    events?.emit('market.analysis.updated', { state, alignment, regime, opportunity, decision });
  }
}
