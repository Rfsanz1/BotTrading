import { Injectable } from '@nestjs/common';
import { CanonicalMarketState } from '../interfaces/canonical-market.interface';
import { MultiTimeframeAlignment } from './multi-timeframe.service';
import { RegimeResult } from './regime.service';
import { StructureState } from './market-structure.service';

export type OpportunityDecision = 'LONG_SETUP' | 'SHORT_SETUP' | 'WATCH' | 'NO_TRADE';
export type NoTradeReason = 'DATA_INVALID' | 'DATA_STALE' | 'ORDERBOOK_INVALID' | 'SEQUENCE_UNHEALTHY' | 'LOW_LIQUIDITY' | 'WIDE_SPREAD' | 'HIGH_SLIPPAGE' | 'TIMEFRAME_CONFLICT' | 'LOW_EDGE' | 'EXTREME_VOLATILITY' | 'LIQUIDATION_EVENT' | 'RISK_LIMIT' | 'STRUCTURE_INVALID' | 'EXECUTION_UNSAFE';

export interface OpportunityResult {
  decision: OpportunityDecision;
  opportunityScore: number;
  setupType: string;
  directionBias: 'LONG' | 'SHORT' | 'NEUTRAL';
  edgeQuality: 'HIGH' | 'MEDIUM' | 'LOW';
  executionQuality: 'EXCELLENT' | 'GOOD' | 'DEGRADED' | 'UNSAFE';
  dataQuality: string;
  noTradeReasons: NoTradeReason[];
  contributionBreakdown: {
    trendContribution: number;
    structureContribution: number;
    momentumContribution: number;
    volumeContribution: number;
    orderFlowContribution: number;
    futuresContribution: number;
    liquidityContribution: number;
    executionContribution: number;
    marketContextContribution: number;
    penalties: number;
  };
}

@Injectable()
export class OpportunityService {
  evaluate(state: CanonicalMarketState, alignment: MultiTimeframeAlignment, regime: RegimeResult, structure?: StructureState): OpportunityResult {
    const reasons: NoTradeReason[] = [];
    if (state.dataQuality.state === 'INVALID') reasons.push('DATA_INVALID');
    if (state.dataQuality.state === 'DEGRADED') reasons.push('DATA_STALE');
    if (!state.orderBook?.sequenceHealthy) reasons.push('SEQUENCE_UNHEALTHY', 'ORDERBOOK_INVALID');
    if (alignment.timeframeConflict) reasons.push('TIMEFRAME_CONFLICT');
    if (!structure || structure.trend === 'UNKNOWN') reasons.push('STRUCTURE_INVALID');
    const spreadBps = state.orderBook?.spreadBps;
    if (spreadBps !== null && spreadBps !== undefined && spreadBps > 30) reasons.push('WIDE_SPREAD');
    const imbalance = state.orderBook?.imbalance10 ?? 0;
    const direction = alignment.higherTimeframeBias === 'BULLISH' ? 'LONG' : alignment.higherTimeframeBias === 'BEARISH' ? 'SHORT' : 'NEUTRAL';
    const structureBias = structure?.trend === 'BULLISH' ? 1 : structure?.trend === 'BEARISH' ? -1 : 0;
    const directionalScore = Math.abs(imbalance) * 0.25 + alignment.timeframeAlignment * 0.35 + regime.regimeConfidence * 0.2 + Math.abs(structureBias) * 0.2;
    if (directionalScore < 0.45) reasons.push('LOW_EDGE');
    const executionQuality = reasons.includes('WIDE_SPREAD') || reasons.includes('SEQUENCE_UNHEALTHY')
      ? 'UNSAFE' : spreadBps !== null && spreadBps !== undefined && spreadBps > 10 ? 'DEGRADED'
        : spreadBps !== null && spreadBps !== undefined && spreadBps <= 2 ? 'EXCELLENT' : 'GOOD';
    if (executionQuality === 'UNSAFE') reasons.push('EXECUTION_UNSAFE');
    const decision: OpportunityDecision = reasons.length
      ? 'NO_TRADE'
      : directionalScore >= 0.7 && direction === 'LONG' ? 'LONG_SETUP'
        : directionalScore >= 0.7 && direction === 'SHORT' ? 'SHORT_SETUP' : 'WATCH';
    return {
      decision,
      opportunityScore: Math.min(1, directionalScore),
      setupType: regime.regime,
      directionBias: direction,
      edgeQuality: directionalScore >= 0.7 ? 'HIGH' : directionalScore >= 0.45 ? 'MEDIUM' : 'LOW',
      executionQuality,
      dataQuality: state.dataQuality.state,
      noTradeReasons: reasons,
      contributionBreakdown: {
        trendContribution: alignment.higherTimeframeBias === 'NEUTRAL' ? 0 : alignment.timeframeAlignment * 0.25,
        structureContribution: structureBias === 0 ? 0 : regime.regimeConfidence * 0.2,
        momentumContribution: 0,
        volumeContribution: 0,
        orderFlowContribution: Math.abs(imbalance) * 0.35,
        futuresContribution: 0,
        liquidityContribution: executionQuality === 'UNSAFE' ? 0 : 0.1,
        executionContribution: executionQuality === 'EXCELLENT' ? 0.1 : executionQuality === 'GOOD' ? 0.05 : 0,
        marketContextContribution: 0,
        penalties: reasons.length * -0.1,
      },
    };
  }
}
