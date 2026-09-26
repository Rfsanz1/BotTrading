import { Injectable } from '@nestjs/common';
import { CanonicalMarketCacheService } from './canonical-market-cache.service';
import { MultiTimeframeService } from './multi-timeframe.service';
import { OpportunityService } from './opportunity.service';
import { RegimeService } from './regime.service';
import { CanonicalMarketType } from '../interfaces/canonical-market.interface';

export interface ScannerCandidate {
  rank: number;
  symbol: string;
  marketType: CanonicalMarketType;
  directionBias: string;
  setupType: string;
  opportunityScore: number;
  executionQuality: string;
  dataQuality: string;
  reasons: string[];
}

export interface ScannerMetrics {
  symbolsSeen: number;
  symbolsEligible: number;
  symbolsRejected: number;
  symbolsDegraded: number;
  candidateCount: number;
  deepAnalysisCount: number;
  aiCount: number;
  noTradeCount: number;
  scanDurationMs: number;
  scanTimestamp: number;
}

@Injectable()
export class UniverseScannerService {
  private lastMetrics: ScannerMetrics = {
    symbolsSeen: 0, symbolsEligible: 0, symbolsRejected: 0, symbolsDegraded: 0,
    candidateCount: 0, deepAnalysisCount: 0, aiCount: 0, noTradeCount: 0,
    scanDurationMs: 0, scanTimestamp: 0,
  };

  constructor(
    private readonly cache: CanonicalMarketCacheService,
    private readonly mtf: MultiTimeframeService,
    private readonly regime: RegimeService,
    private readonly opportunity: OpportunityService,
  ) {}

  scan(symbols: string[], marketType: CanonicalMarketType, topN = 10): { candidates: ScannerCandidate[]; metrics: ScannerMetrics } {
    const started = Date.now();
    const candidates: ScannerCandidate[] = [];
    let rejected = 0;
    let degraded = 0;
    for (const symbol of [...new Set(symbols.map((value) => value.toUpperCase()))]) {
      const state = this.cache.get(symbol, marketType);
      if (!state) { rejected += 1; continue; }
      if (state.dataQuality.state === 'DEGRADED') degraded += 1;
      if (state.dataQuality.state !== 'HEALTHY' || !state.orderBook?.sequenceHealthy) { rejected += 1; continue; }
      const alignment = this.mtf.align(state.timeframes);
      const regime = this.regime.evaluate(state, alignment, state.structure[alignment.entryTimeframe]);
      const opportunity = this.opportunity.evaluate(state, alignment, regime, state.structure[alignment.entryTimeframe]);
      if (opportunity.decision === 'NO_TRADE' || opportunity.decision === 'WATCH') continue;
      candidates.push({
        rank: 0, symbol: state.symbol, marketType, directionBias: opportunity.directionBias,
        setupType: opportunity.setupType, opportunityScore: opportunity.opportunityScore,
        executionQuality: opportunity.executionQuality, dataQuality: state.dataQuality.state,
        reasons: opportunity.noTradeReasons,
      });
    }
    candidates.sort((a, b) => b.opportunityScore - a.opportunityScore || a.symbol.localeCompare(b.symbol));
    const selected = candidates.slice(0, Math.max(0, topN)).map((candidate, index) => ({ ...candidate, rank: index + 1 }));
    this.lastMetrics = {
      symbolsSeen: symbols.length, symbolsEligible: symbols.length - rejected,
      symbolsRejected: rejected, symbolsDegraded: degraded, candidateCount: candidates.length,
      deepAnalysisCount: selected.length, aiCount: 0, noTradeCount: Math.max(0, symbols.length - selected.length),
      scanDurationMs: Date.now() - started, scanTimestamp: Date.now(),
    };
    return { candidates: selected, metrics: this.lastMetrics };
  }

  metrics(): ScannerMetrics { return { ...this.lastMetrics }; }
}
