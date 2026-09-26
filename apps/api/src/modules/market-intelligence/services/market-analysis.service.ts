import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CanonicalMarketState } from '../interfaces/canonical-market.interface';
import { MultiTimeframeService } from './multi-timeframe.service';
import { OpportunityService } from './opportunity.service';
import { RegimeService } from './regime.service';
import { TradingDecisionPipelineService } from './trading-decision-pipeline.service';
import { MarketObservabilityService } from './market-observability.service';
import { AnalysisService } from '../../analysis/services/analysis.service';

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
    if (opportunity.decision === 'LONG_SETUP' || opportunity.decision === 'SHORT_SETUP') {
      try {
        aiOutput = await this.ai.validateCandidate(state.symbol, {
          timestamp: state.lastUpdate,
          bid: state.bid,
          ask: state.ask,
          lastPrice: state.lastPrice,
          dataQuality: state.dataQuality,
          timeframes: state.timeframes,
          structure: state.structure,
          regime,
          opportunity,
        }, opportunity.setupType);
      } catch (error) {
        this.logger.warn(`AI validation unavailable for ${state.symbol}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    const decision = this.pipeline.evaluate(state, { aiOutput });
    if (opportunity.decision === 'LONG_SETUP' || opportunity.decision === 'SHORT_SETUP') {
      const reason = decision.authorizationReason
        ?? (decision.finalStatus === 'AUTHORIZED_FOR_PAPER' ? 'AUTHORIZED_FOR_PAPER' : decision.reasons[0] ?? 'OTHER');
      this.metrics.recordAuthorization(reason, decision.finalStatus === 'AUTHORIZED_FOR_PAPER');
      if (decision.calibrationState === 'COLD_START') this.metrics.increment('calibrationColdStart');
      this.metrics.set('calibrationSampleSize', Number(process.env.PAPER_CALIBRATION_SAMPLE_SIZE ?? 0));
    }
    events?.emit('market.analysis.updated', { state, alignment, regime, opportunity, decision });
  }
}
