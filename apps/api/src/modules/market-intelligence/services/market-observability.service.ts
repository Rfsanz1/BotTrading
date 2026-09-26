import { Injectable } from '@nestjs/common';
import * as promClient from 'prom-client';

export interface MarketObservabilitySnapshot {
  streamConnections: number;
  activeShards: number;
  reconnects: number;
  rotations: number;
  streamFailures: number;
  sequenceGaps: number;
  resyncAttempts: number;
  resyncSuccess: number;
  resyncFailures: number;
  candleGaps: number;
  candleBackfills: number;
  candleBackfillFailures: number;
  staleSymbols: number;
  degradedSymbols: number;
  invalidSymbols: number;
  scans: number;
  registryTotal: number;
  registryEnabled: number;
  registrySpotUsdt: number;
  hydrationRequested: number;
  hydrationSucceeded: number;
  hydrationFailed: number;
  candlesHydrated: number;
  orderbooksHydrated: number;
  canonicalPopulated: number;
  canonicalFresh: number;
  canonicalStale: number;
  scannerDataEligible: number;
  scannerDataRejected: number;
  symbolsSeen: number;
  symbolsEligible: number;
  symbolsRejected: number;
  candidates: number;
  noTrades: number;
  scannerDurationMs: number;
  aiCalls: number;
  aiSuccesses: number;
  aiInvalid: number;
  aiUnavailable: number;
  riskApproved: number;
  riskRejected: number;
  paperOrders: number;
  paperFills: number;
  paperRejects: number;
  paperPnl: number;
  paperFees: number;
  paperSlippage: number;
  calibrationPredictions: number;
  calibrationOutcomes: number;
  calibrationSamples: number;
  brierScore: number | null;
  authorizationCandidatesEvaluated: number;
  authorizedForPaper: number;
  authorizationRejected: number;
  calibrationSampleSize: number;
  calibrationColdStart: number;
  authorizationByReason: Record<string, number>;
}

@Injectable()
export class MarketObservabilityService {
  private readonly gauges = new Map<keyof MarketObservabilitySnapshot, promClient.Gauge<string>>();
  private readonly values: MarketObservabilitySnapshot = {
    streamConnections: 0, activeShards: 0, reconnects: 0, rotations: 0, streamFailures: 0,
    sequenceGaps: 0, resyncAttempts: 0, resyncSuccess: 0, resyncFailures: 0,
    candleGaps: 0, candleBackfills: 0, candleBackfillFailures: 0, staleSymbols: 0,
    degradedSymbols: 0, invalidSymbols: 0, scans: 0, registryTotal: 0, registryEnabled: 0,
    registrySpotUsdt: 0, symbolsSeen: 0, symbolsEligible: 0, symbolsRejected: 0,
    hydrationRequested: 0, hydrationSucceeded: 0, hydrationFailed: 0, candlesHydrated: 0,
    orderbooksHydrated: 0, canonicalPopulated: 0, canonicalFresh: 0, canonicalStale: 0,
    scannerDataEligible: 0, scannerDataRejected: 0,
    candidates: 0, noTrades: 0,
    scannerDurationMs: 0, aiCalls: 0, aiSuccesses: 0, aiInvalid: 0, aiUnavailable: 0,
    riskApproved: 0, riskRejected: 0, paperOrders: 0, paperFills: 0, paperRejects: 0,
    paperPnl: 0, paperFees: 0, paperSlippage: 0, calibrationPredictions: 0,
    calibrationOutcomes: 0, calibrationSamples: 0, brierScore: null,
    authorizationCandidatesEvaluated: 0, authorizedForPaper: 0, authorizationRejected: 0,
    calibrationSampleSize: 0, calibrationColdStart: 0, authorizationByReason: {},
  };

  constructor() {
    for (const key of Object.keys(this.values) as Array<keyof MarketObservabilitySnapshot>) {
      const metricName = `market_intelligence_${key}`;
      const existing = promClient.register.getSingleMetric(metricName) as promClient.Gauge<string> | undefined;
      this.gauges.set(key, existing ?? new promClient.Gauge({ name: metricName, help: `Market intelligence ${key}` }));
    }
    this.publish();
  }

  increment<K extends keyof MarketObservabilitySnapshot>(key: K, amount = 1): void {
    const current = this.values[key];
    if (typeof current === 'number') {
      this.values[key] = (current + amount) as MarketObservabilitySnapshot[K];
      this.publishKey(key);
    }
  }

  set<K extends keyof MarketObservabilitySnapshot>(key: K, value: MarketObservabilitySnapshot[K]): void {
    this.values[key] = value;
    this.publishKey(key);
  }

  snapshot(): MarketObservabilitySnapshot { return { ...this.values }; }

  recordAuthorization(reason: string, authorized: boolean): void {
    this.values.authorizationCandidatesEvaluated += 1;
    if (authorized) this.values.authorizedForPaper += 1;
    else {
      this.values.authorizationRejected += 1;
      this.values.authorizationByReason[reason] = (this.values.authorizationByReason[reason] ?? 0) + 1;
    }
    this.publishKey('authorizationCandidatesEvaluated');
    this.publishKey('authorizedForPaper');
    this.publishKey('authorizationRejected');
  }

  setAuthorizationByReason(reasons: Record<string, number>): void {
    this.values.authorizationByReason = { ...reasons };
  }

  private publish(): void {
    for (const key of Object.keys(this.values) as Array<keyof MarketObservabilitySnapshot>) this.publishKey(key);
  }

  private publishKey(key: keyof MarketObservabilitySnapshot): void {
    const value = this.values[key];
    if (typeof value === 'number') this.gauges.get(key)?.set(value);
  }
}
