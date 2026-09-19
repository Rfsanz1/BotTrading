import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import {
  TradeHistory,
  LearningRecord,
  Insight,
  PredictionRecord,
  TradeOutcomeRecord,
  ModelPerformance,
  ModelWeightHistory,
  CalibrationBucket,
  LearningInsight,
} from './types';

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));

type DbStore = {
  tradeDecisionSnapshot?: { findMany?: (args?: any) => any[]; findUnique?: (args?: any) => any; upsert?: (args?: any) => any };
  tradeOutcome?: { findMany?: (args?: any) => any[]; findUnique?: (args?: any) => any; upsert?: (args?: any) => any };
  modelPerformance?: { findMany?: (args?: any) => any[]; upsert?: (args?: any) => any };
  modelWeightHistory?: { create?: (args?: any) => any; findMany?: (args?: any) => any[] };
  calibrationRecord?: { upsert?: (args?: any) => any; findMany?: (args?: any) => any[] };
  $transaction?: <T>(fn: (tx: any) => Promise<T>) => Promise<T>;
};

const defaultState = (): {
  predictions: PredictionRecord[];
  outcomes: TradeOutcomeRecord[];
  weightHistory: ModelWeightHistory[];
  calibrationBuckets: CalibrationBucket[];
  insights: LearningInsight[];
} => ({
  predictions: [],
  outcomes: [],
  weightHistory: [],
  calibrationBuckets: [],
  insights: [],
});

export class LearningSystem {
  private readonly storagePath: string;
  private readonly db?: DbStore;
  private state: ReturnType<typeof defaultState>;

  constructor(storagePath?: string, db?: DbStore) {
    this.storagePath = storagePath ?? path.resolve(process.cwd(), 'artifacts', 'learning-state.json');
    this.db = db;
    this.state = this.loadState();
    if (this.db) {
      void this.refreshFromDatabase();
    }
  }

  private loadState() {
    try {
      const resolved = path.resolve(this.storagePath);
      if (!existsSync(resolved)) return defaultState();
      const raw = JSON.parse(readFileSync(resolved, 'utf8'));
      return {
        predictions: Array.isArray(raw.predictions) ? raw.predictions : [],
        outcomes: Array.isArray(raw.outcomes) ? raw.outcomes : [],
        weightHistory: Array.isArray(raw.weightHistory) ? raw.weightHistory : [],
        calibrationBuckets: Array.isArray(raw.calibrationBuckets) ? raw.calibrationBuckets : [],
        insights: Array.isArray(raw.insights) ? raw.insights : [],
      };
    } catch {
      return defaultState();
    }
  }

  private persist(): void {
    mkdirSync(path.dirname(this.storagePath), { recursive: true });
    writeFileSync(this.storagePath, JSON.stringify(this.state, null, 2));
  }

  private async refreshFromDatabase(): Promise<void> {
    if (!this.db) return;
    try {
      const snapshots = this.db.tradeDecisionSnapshot?.findMany ? await this.db.tradeDecisionSnapshot.findMany() : [];
      const outcomes = this.db.tradeOutcome?.findMany ? await this.db.tradeOutcome.findMany() : [];
      const predictionRecords = snapshots.map((snapshot: any) => ({
        decisionId: snapshot.decisionId,
        timestamp: new Date(snapshot.timestamp).getTime(),
        symbol: snapshot.symbol ?? 'UNKNOWN',
        provider: snapshot.aiOutputs?.provider ?? 'unknown',
        model: snapshot.aiOutputs?.model ?? 'unknown',
        regime: snapshot.regime ?? undefined,
        setup: snapshot.setup ?? undefined,
        action: snapshot.decision ?? 'HOLD',
        rawConfidence: Number(snapshot.rawConfidence ?? 0),
        predictedProbability: Number(snapshot.calibratedProbability ?? snapshot.rawConfidence ?? 0),
        actualOutcome: outcomes.find((outcome: any) => outcome.decisionId === snapshot.decisionId)?.winLoss ?? 'pending',
        realizedPnL: Number(outcomes.find((outcome: any) => outcome.decisionId === snapshot.decisionId)?.realizedPnL ?? 0),
        realizedR: Number(outcomes.find((outcome: any) => outcome.decisionId === snapshot.decisionId)?.realizedR ?? 0),
        metadata: {
          marketSnapshot: snapshot.marketSnapshot,
          aiOutputs: snapshot.aiOutputs,
          consensus: snapshot.consensus,
          expectedValue: snapshot.expectedValue,
          expectedValueAfterCost: snapshot.expectedValueAfterCost,
          entry: snapshot.entry,
          stopLoss: snapshot.stopLoss,
          takeProfit: snapshot.takeProfit,
          riskReward: snapshot.riskReward,
          positionSize: snapshot.positionSize,
          riskAmount: snapshot.riskAmount,
          portfolioHeat: snapshot.portfolioHeat,
          reasoning: snapshot.reasoning,
        },
      }));

      this.state.predictions = predictionRecords;
      this.state.outcomes = outcomes.map((outcome: any) => ({
        decisionId: outcome.decisionId,
        timestamp: new Date(outcome.closedAt ?? outcome.createdAt ?? Date.now()).getTime(),
        symbol: outcome.decision?.symbol ?? 'UNKNOWN',
        provider: outcome.decision?.aiOutputs?.provider ?? 'unknown',
        model: outcome.decision?.aiOutputs?.model ?? 'unknown',
        regime: outcome.decision?.regime ?? undefined,
        setup: outcome.decision?.setup ?? undefined,
        outcome: outcome.winLoss === 'win' ? 'win' : outcome.winLoss === 'loss' ? 'loss' : 'neutral',
        entryPrice: Number(outcome.entryPrice ?? 0),
        exitPrice: Number(outcome.exitPrice ?? 0),
        realizedPnL: Number(outcome.realizedPnL ?? 0),
        realizedR: Number(outcome.realizedR ?? 0),
        fees: Number(outcome.fees ?? 0),
        slippage: Number(outcome.slippage ?? 0),
        holdingTimeMs: Number(outcome.holdingTime ?? 0),
        exitReason: outcome.exitReason ?? undefined,
        decision: outcome.decision?.decision ?? 'HOLD',
      }));
      this.updateCalibration();
      this.updateWeightHistory();
    } catch {
      // Ignore DB refresh failures; state remains usable and reverts to JSON fallback.
    }
  }

  private normalizePrediction(input: Partial<PredictionRecord>): PredictionRecord {
    const rawValue = input.rawConfidence != null ? Number(input.rawConfidence) : 0;
    const rawConfidence = clamp(Number.isFinite(rawValue) ? rawValue : 0, 0, 1);
    const predictedValue = input.predictedProbability != null ? Number(input.predictedProbability) : rawConfidence;
    const predictedProbability = clamp(Number.isFinite(predictedValue) ? predictedValue : rawConfidence, 0, 1);

    return {
      decisionId: input.decisionId ?? `decision-${Date.now()}-${Math.random().toString(16).slice(2)}`,
      timestamp: input.timestamp ?? Date.now(),
      symbol: input.symbol ?? 'UNKNOWN',
      provider: input.provider ?? 'unknown',
      model: input.model ?? 'unknown',
      regime: input.regime,
      setup: input.setup,
      action: input.action ?? 'HOLD',
      rawConfidence,
      predictedProbability,
      actualOutcome: input.actualOutcome ?? 'pending',
      realizedPnL: input.realizedPnL,
      realizedR: input.realizedR,
      metadata: input.metadata ?? {},
    };
  }

  private computeCalibrationStatus(sampleSize: number): 'INSUFFICIENT_DATA' | 'LIMITED' | 'CALIBRATED' {
    if (sampleSize >= 100) return 'CALIBRATED';
    if (sampleSize >= 30) return 'LIMITED';
    return 'INSUFFICIENT_DATA';
  }

  private async persistPredictionToDb(record: PredictionRecord): Promise<void> {
    const snapshotStore = this.db?.tradeDecisionSnapshot;
    if (!snapshotStore || typeof snapshotStore.upsert !== 'function') return;
    const payload: any = {
      decisionId: record.decisionId,
      timestamp: new Date(record.timestamp),
      symbol: record.symbol,
      exchange: record.metadata?.exchange ?? 'SYSTEM',
      timeframe: record.metadata?.timeframe ?? null,
      marketSnapshot: record.metadata?.marketSnapshot ?? null,
      regime: record.regime ?? null,
      regimeConfidence: record.metadata?.regimeConfidence ?? null,
      setup: record.setup ?? null,
      setupConfidence: record.metadata?.setupConfidence ?? null,
      featureSnapshot: record.metadata?.featureSnapshot ?? null,
      aiOutputs: record.metadata?.aiOutputs ?? { provider: record.provider, model: record.model },
      consensus: record.metadata?.consensus ?? null,
      rawConfidence: record.rawConfidence,
      calibratedProbability: record.predictedProbability,
      calibrationStatus: this.computeCalibrationStatus(this.state.predictions.filter((p) => p.actualOutcome && p.actualOutcome !== 'pending').length + 1),
      expectedValue: record.metadata?.expectedValue ?? null,
      expectedValueAfterCost: record.metadata?.expectedValueAfterCost ?? null,
      entry: record.metadata?.entry ?? null,
      stopLoss: record.metadata?.stopLoss ?? null,
      takeProfit: record.metadata?.takeProfit ?? null,
      riskReward: record.metadata?.riskReward ?? null,
      positionSize: record.metadata?.positionSize ?? null,
      riskAmount: record.metadata?.riskAmount ?? null,
      portfolioHeat: record.metadata?.portfolioHeat ?? null,
      decision: record.action,
      reasoning: record.metadata?.reasoning ?? null,
      invalidationConditions: record.metadata?.invalidationConditions ?? null,
      strategyVersion: record.metadata?.strategyVersion ?? null,
      featureVersion: record.metadata?.featureVersion ?? null,
      promptVersion: record.metadata?.promptVersion ?? null,
      decisionVersion: record.metadata?.decisionVersion ?? null,
    };

    await snapshotStore.upsert({
      where: { decisionId: record.decisionId },
      update: payload,
      create: payload,
    });
  }

  private async persistOutcomeToDb(outcome: TradeOutcomeRecord): Promise<void> {
    const outcomeStore = this.db?.tradeOutcome;
    const txFn = this.db?.$transaction;
    if (!outcomeStore || typeof outcomeStore.upsert !== 'function' || typeof txFn !== 'function') return;
    await txFn(async (tx: any) => {
      await tx.tradeOutcome.upsert({
        where: { decisionId: outcome.decisionId },
        update: {
          entryPrice: outcome.entryPrice,
          exitPrice: outcome.exitPrice,
          realizedPnL: outcome.realizedPnL,
          realizedR: outcome.realizedR,
          fees: outcome.fees,
          slippage: outcome.slippage,
          mfe: Math.max(outcome.realizedR ?? 0, 0),
          mae: Math.abs(outcome.realizedR ?? 0),
          holdingTime: Math.max(Math.round(outcome.holdingTimeMs / 1000), 0),
          exitReason: outcome.exitReason ?? null,
          winLoss: outcome.outcome,
          openedAt: new Date(outcome.timestamp),
          closedAt: new Date(outcome.timestamp),
        },
        create: {
          decisionId: outcome.decisionId,
          entryPrice: outcome.entryPrice,
          exitPrice: outcome.exitPrice,
          realizedPnL: outcome.realizedPnL,
          realizedR: outcome.realizedR,
          fees: outcome.fees,
          slippage: outcome.slippage,
          mfe: Math.max(outcome.realizedR ?? 0, 0),
          mae: Math.abs(outcome.realizedR ?? 0),
          holdingTime: Math.max(Math.round(outcome.holdingTimeMs / 1000), 0),
          exitReason: outcome.exitReason ?? null,
          winLoss: outcome.outcome,
          openedAt: new Date(outcome.timestamp),
          closedAt: new Date(outcome.timestamp),
        },
      });

      await tx.tradeDecisionSnapshot.upsert({
        where: { decisionId: outcome.decisionId },
        update: {
          decision: outcome.decision ?? 'HOLD',
          symbol: outcome.symbol,
          rawConfidence: 0,
        },
        create: {
          decisionId: outcome.decisionId,
          timestamp: new Date(outcome.timestamp),
          symbol: outcome.symbol,
          decision: outcome.decision ?? 'HOLD',
          rawConfidence: 0,
        },
      });
    });
  }

  recordPrediction(input: Partial<PredictionRecord>): PredictionRecord {
    const record = this.normalizePrediction(input);
    const existing = this.state.predictions.find((p) => p.decisionId === record.decisionId);
    if (existing) {
      Object.assign(existing, record);
      this.updateCalibration();
      this.persist();
      if (this.db) {
        void this.persistPredictionToDb(existing);
      }
      return existing;
    }

    this.state.predictions.push(record);
    this.updateCalibration();
    this.persist();
    if (this.db) {
      void this.persistPredictionToDb(record);
    }
    return record;
  }

  recordTradeResult(input: Partial<TradeOutcomeRecord> & { decisionId: string }): TradeOutcomeRecord {
    const decisionId = input.decisionId;
    const existing = this.state.outcomes.find((o) => o.decisionId === decisionId);
    if (existing) return existing;

    const outcome: TradeOutcomeRecord = {
      decisionId,
      timestamp: input.timestamp ?? Date.now(),
      symbol: input.symbol ?? 'UNKNOWN',
      provider: input.provider ?? 'unknown',
      model: input.model ?? 'unknown',
      regime: input.regime,
      setup: input.setup,
      outcome: input.outcome ?? 'neutral',
      entryPrice: Number.isFinite(input.entryPrice ?? 0) ? Number(input.entryPrice ?? 0) : 0,
      exitPrice: Number.isFinite(input.exitPrice ?? 0) ? Number(input.exitPrice ?? 0) : 0,
      realizedPnL: Number.isFinite(input.realizedPnL ?? 0) ? Number(input.realizedPnL ?? 0) : 0,
      realizedR: Number.isFinite(input.realizedR ?? 0) ? Number(input.realizedR ?? 0) : 0,
      fees: Number.isFinite(input.fees ?? 0) ? Number(input.fees ?? 0) : 0,
      slippage: Number.isFinite(input.slippage ?? 0) ? Number(input.slippage ?? 0) : 0,
      holdingTimeMs: Number.isFinite(input.holdingTimeMs ?? 0) ? Number(input.holdingTimeMs ?? 0) : 0,
      exitReason: input.exitReason,
      decision: input.decision ?? 'HOLD',
    };

    this.state.outcomes.push(outcome);
    const prediction = this.state.predictions.find((p) => p.decisionId === decisionId);
    if (prediction) {
      prediction.actualOutcome = outcome.outcome;
      prediction.realizedPnL = outcome.realizedPnL;
      prediction.realizedR = outcome.realizedR;
    }

    this.updateCalibration();
    this.updateWeightHistory();
    this.persist();
    if (this.db) {
      void this.persistOutcomeToDb(outcome);
    }
    return outcome;
  }

  private updateCalibration(): void {
    const completed = this.state.predictions.filter((p) => p.actualOutcome && p.actualOutcome !== 'pending');
    if (completed.length === 0) {
      this.state.calibrationBuckets = [];
      return;
    }

    const buckets = [
      { bucket: '0-49', min: 0, max: 49 },
      { bucket: '50-59', min: 50, max: 59 },
      { bucket: '60-69', min: 60, max: 69 },
      { bucket: '70-79', min: 70, max: 79 },
      { bucket: '80-89', min: 80, max: 89 },
      { bucket: '90-100', min: 90, max: 100 },
    ];

    this.state.calibrationBuckets = buckets.map((bucket) => {
      const matches = completed.filter((p) => {
        const conf = Math.round(p.predictedProbability * 100);
        return conf >= bucket.min && conf <= bucket.max;
      });
      if (matches.length === 0) return { bucket: bucket.bucket, samples: 0, predicted_probability: 0, actual_win_rate: 0, calibration_error: 0 };

      const expected = matches.reduce((sum, p) => sum + p.predictedProbability, 0) / matches.length;
      const actual = matches.filter((p) => p.actualOutcome === 'win').length / matches.length;
      return {
        bucket: bucket.bucket,
        samples: matches.length,
        predicted_probability: expected,
        actual_win_rate: actual,
        calibration_error: Math.abs(expected - actual),
      };
    });
  }

  private updateWeightHistory(): void {
    const recentPerformance = this.getModelPerformance();
    for (const perf of recentPerformance) {
      const key = `${perf.provider}:${perf.model}:${perf.symbol ?? '*'}:${perf.regime ?? '*'}:${perf.setup ?? '*'}`;
      const currentWeight = this.getModelWeight(perf.provider, perf.model, perf.symbol, perf.regime, perf.setup);
      const previous = this.state.weightHistory
        .filter((entry) => `${entry.provider}:${entry.model}:${entry.symbol ?? '*'}:${entry.regime ?? '*'}:${entry.setup ?? '*'}` === key)
        .sort((a, b) => b.created_at - a.created_at)[0];
      const oldWeight = previous ? previous.new_weight : 0.5;
      if (Math.abs(currentWeight - oldWeight) > 0.01) {
        this.state.weightHistory.push({
          weight_version: `v${Date.now()}`,
          provider: perf.provider,
          model: perf.model,
          symbol: perf.symbol,
          regime: perf.regime,
          setup: perf.setup,
          old_weight: oldWeight,
          new_weight: currentWeight,
          reason: 'Updated from actual prediction history and calibration',
          sample_size: perf.prediction_count,
          created_at: Date.now(),
        });
      }
    }
  }

  private shrinkRate(successes: number, total: number, priorMean = 0.5): number {
    const n = Math.max(total, 0);
    if (n === 0) return priorMean;
    const alpha = 2;
    const beta = 2;
    const adjusted = (alpha + successes) / (alpha + beta + n);
    return clamp(adjusted, 0.05, 0.95);
  }

  private buildPerformanceSummary(filteredPredictions: PredictionRecord[]): ModelPerformance {
    const outcomes = filteredPredictions
      .map((prediction) => ({ prediction, outcome: this.state.outcomes.find((o) => o.decisionId === prediction.decisionId) }))
      .filter((entry) => entry.outcome);

    const completed = outcomes.map((entry) => entry.outcome!);
    const wins = completed.filter((outcome) => outcome.outcome === 'win').length;
    const losses = completed.filter((outcome) => outcome.outcome === 'loss').length;
    const actualWinRate = completed.length > 0 ? wins / completed.length : 0;
    const rrValues = completed.map((entry) => entry.realizedR ?? 0);
    const avgR = rrValues.length > 0 ? rrValues.reduce((sum, value) => sum + value, 0) / rrValues.length : 0;
    const positiveR = rrValues.filter((value) => value > 0).reduce((sum, value) => sum + value, 0);
    const negativeR = Math.abs(rrValues.filter((value) => value < 0).reduce((sum, value) => sum + value, 0));
    const profitFactor = negativeR > 0 ? positiveR / negativeR : positiveR > 0 ? 999 : 0;
    const confidenceValues = filteredPredictions.map((p) => clamp(Number(p.rawConfidence || 0), 0, 1));
    const avgConfidence = confidenceValues.length > 0 ? confidenceValues.reduce((sum, value) => sum + value, 0) / confidenceValues.length : 0;
    const avgMfe = completed.length > 0 ? completed.reduce((sum, outcome) => sum + (Number(outcome.realizedR ?? 0) * 0.5), 0) / completed.length : 0;
    const avgMae = completed.length > 0 ? completed.reduce((sum, outcome) => sum + Math.abs(Number(outcome.realizedR ?? 0) * 0.3), 0) / completed.length : 0;
    const recent = outcomes.slice(-20);
    const recentWinRate = recent.length > 0 ? recent.filter((entry) => entry.outcome!.outcome === 'win').length / recent.length : 0;

    const calibration = this.getConfidenceCalibration();
    const calibrationError = calibration.buckets.reduce((sum, bucket) => sum + bucket.calibration_error, 0) / Math.max(1, calibration.buckets.length);
    const safeWinRate = this.shrinkRate(wins, completed.length, 0.5);

    return {
      provider: filteredPredictions[0]?.provider ?? 'unknown',
      model: filteredPredictions[0]?.model ?? 'unknown',
      symbol: filteredPredictions[0]?.symbol,
      regime: filteredPredictions[0]?.regime,
      setup: filteredPredictions[0]?.setup,
      prediction_count: filteredPredictions.length,
      correct_count: outcomes.filter(({ prediction, outcome }) => {
        const matchedAction =
          (prediction.action === 'BUY' && outcome?.outcome === 'win') ||
          (prediction.action === 'SELL' && outcome?.outcome === 'loss') ||
          (prediction.action === 'HOLD' && outcome?.outcome === 'neutral');
        return matchedAction;
      }).length,
      win_rate: Number((safeWinRate || actualWinRate).toFixed(4)),
      actual_win_rate: Number(actualWinRate.toFixed(4)),
      avg_confidence: Number(avgConfidence.toFixed(4)),
      avg_R: Number(avgR.toFixed(4)),
      profit_factor: Number(profitFactor.toFixed(4)),
      avg_mfe: Number(avgMfe.toFixed(4)),
      avg_mae: Number(avgMae.toFixed(4)),
      calibration_error: Number(calibrationError.toFixed(4)),
      recent_win_rate: Number(recentWinRate.toFixed(4)),
      recent_avg_R: Number((recent.length > 0 ? recent.reduce((sum, entry) => sum + (entry.outcome?.realizedR ?? 0), 0) / recent.length : 0).toFixed(4)),
      last_updated: Date.now(),
    };
  }

  getModelPerformance(
    provider?: string,
    model?: string,
    symbol?: string,
    regime?: string,
    setup?: string,
  ): ModelPerformance[] {
    const filtered = this.state.predictions.filter((p) => {
      if (provider && p.provider !== provider) return false;
      if (model && p.model !== model) return false;
      if (symbol && p.symbol !== symbol) return false;
      if (regime && p.regime !== regime) return false;
      if (setup && p.setup !== setup) return false;
      return true;
    });

    const grouped = new Map<string, PredictionRecord[]>();
    for (const prediction of filtered) {
      const key = `${prediction.provider}:${prediction.model}:${prediction.symbol}:${prediction.regime ?? '*'}:${prediction.setup ?? '*'}`;
      const bucket = grouped.get(key) ?? [];
      bucket.push(prediction);
      grouped.set(key, bucket);
    }

    return [...grouped.values()].map((records) => this.buildPerformanceSummary(records));
  }

  getSetupPerformance(setup?: string): ModelPerformance[] {
    return this.getModelPerformance(undefined, undefined, undefined, undefined, setup);
  }

  getRegimePerformance(regime?: string): ModelPerformance[] {
    return this.getModelPerformance(undefined, undefined, undefined, regime, undefined);
  }

  getSymbolPerformance(symbol?: string): ModelPerformance[] {
    return this.getModelPerformance(undefined, undefined, symbol, undefined, undefined);
  }

  getConfidenceCalibration(): { status: 'INSUFFICIENT_DATA' | 'LIMITED' | 'CALIBRATED'; sampleSize: number; buckets: CalibrationBucket[]; calibrationError: number; } {
    const completed = this.state.predictions.filter((p) => p.actualOutcome && p.actualOutcome !== 'pending');
    const sampleSize = completed.length;
    const buckets = this.state.calibrationBuckets.length > 0 ? this.state.calibrationBuckets : [];
    const calibrationError = buckets.length > 0 ? buckets.reduce((sum, bucket) => sum + bucket.calibration_error, 0) / buckets.length : 0;

    let status: 'INSUFFICIENT_DATA' | 'LIMITED' | 'CALIBRATED' = 'INSUFFICIENT_DATA';
    if (sampleSize >= 100) status = 'CALIBRATED';
    else if (sampleSize >= 30) status = 'LIMITED';

    return { status, sampleSize, buckets, calibrationError };
  }

  getModelWeight(provider: string, model: string, symbol?: string, regime?: string, setup?: string): number {
    const perf = this.getModelPerformance(provider, model, symbol, regime, setup);
    const best = perf[0];
    if (!best || best.prediction_count < 3) return 0.1;

    const safeWinRate = clamp(best.win_rate, 0.05, 0.95);
    const recentBoost = clamp(best.recent_win_rate, 0.05, 0.95);
    const calibrationBoost = clamp(1 - best.calibration_error, 0.1, 1);
    const profitBoost = clamp(Math.min(best.profit_factor, 3) / 3, 0.1, 1);
    const weighted = 0.25 * safeWinRate + 0.2 * recentBoost + 0.2 * calibrationBoost + 0.15 * profitBoost + 0.2 * Math.min(best.prediction_count / 50, 1);
    return clamp(weighted, 0.08, 1.4);
  }

  getLearningInsights(symbol?: string): {
    modelInsights: LearningInsight[];
    symbolInsights: LearningInsight[];
    regimeInsights: LearningInsight[];
    setupInsights: LearningInsight[];
    confidenceInsights: LearningInsight[];
    warnings: string[];
  } {
    const modelInsights: LearningInsight[] = [];
    const symbolInsights: LearningInsight[] = [];
    const regimeInsights: LearningInsight[] = [];
    const setupInsights: LearningInsight[] = [];
    const confidenceInsights: LearningInsight[] = [];
    const warnings: string[] = [];

    const modelStats = this.getModelPerformance();
    for (const stats of modelStats) {
      if (!stats || stats.prediction_count < 5) continue;
      if (stats.win_rate > 0.6) {
        modelInsights.push({
          kind: 'model',
          scope: `${stats.provider}/${stats.model}`,
          summary: `${stats.provider}/${stats.model} has a favorable shrunken win rate of ${stats.win_rate.toFixed(2)} over ${stats.prediction_count} predictions.`,
          severity: 'positive',
          createdAt: Date.now(),
        });
      } else if (stats.win_rate < 0.4) {
        modelInsights.push({
          kind: 'model',
          scope: `${stats.provider}/${stats.model}`,
          summary: `${stats.provider}/${stats.model} is underperforming and should be down-weighted for live consensus.`,
          severity: 'warning',
          createdAt: Date.now(),
        });
      }
    }

    const symbolStats = this.getSymbolPerformance(symbol);
    for (const stats of symbolStats) {
      if (stats.prediction_count >= 5) {
        symbolInsights.push({
          kind: 'symbol',
          scope: `${stats.symbol ?? 'UNKNOWN'}`,
          summary: `${stats.symbol ?? 'UNKNOWN'} has ${stats.win_rate.toFixed(2)} shrunken win rate over ${stats.prediction_count} completed decisions.`,
          severity: stats.win_rate > 0.5 ? 'positive' : 'warning',
          createdAt: Date.now(),
        });
      }
    }

    const regimeStats = this.getRegimePerformance();
    for (const stats of regimeStats) {
      if (stats.prediction_count >= 5) {
        regimeInsights.push({
          kind: 'regime',
          scope: `${stats.regime ?? 'UNKNOWN'}`,
          summary: `${stats.regime ?? 'UNKNOWN'} regime has ${stats.win_rate.toFixed(2)} historical win rate.`,
          severity: stats.win_rate > 0.5 ? 'positive' : 'warning',
          createdAt: Date.now(),
        });
      }
    }

    const setupStats = this.getSetupPerformance();
    for (const stats of setupStats) {
      if (stats.prediction_count >= 5) {
        setupInsights.push({
          kind: 'setup',
          scope: `${stats.setup ?? 'UNKNOWN'}`,
          summary: `${stats.setup ?? 'UNKNOWN'} setup currently has expectancy ${stats.avg_R.toFixed(2)}R and win rate ${stats.win_rate.toFixed(2)}.`,
          severity: stats.avg_R > 0 ? 'positive' : 'warning',
          createdAt: Date.now(),
        });
      }
    }

    const calibration = this.getConfidenceCalibration();
    if (calibration.status !== 'CALIBRATED') {
      warnings.push(`Confidence calibration is ${calibration.status.toLowerCase()}; use conservative probability estimates.`);
    }
    confidenceInsights.push({
      kind: 'confidence',
      scope: 'all',
      summary: `Calibration status is ${calibration.status} with average calibration error ${calibration.calibrationError.toFixed(3)} over ${calibration.sampleSize} predictions.`,
      severity: calibration.status === 'CALIBRATED' ? 'positive' : 'warning',
      createdAt: Date.now(),
    });

    if (this.state.predictions.length === 0) {
      warnings.push('No prediction history recorded yet; model weights remain conservative.');
    }

    return {
      modelInsights,
      symbolInsights,
      regimeInsights,
      setupInsights,
      confidenceInsights,
      warnings,
    };
  }

  analyzeTradingHistory(trades: TradeHistory[]): LearningRecord {
    if (trades.length === 0) {
      return this.createEmptyLearningRecord();
    }

    const completedTrades = trades.filter((t) => t.result);
    const wins = completedTrades.filter((t) => t.result!.pnl > 0);
    const losses = completedTrades.filter((t) => t.result!.pnl < 0);
    const successRate = completedTrades.length > 0 ? wins.length / completedTrades.length : 0;
    const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + (b.result?.pnl || 0), 0) / wins.length : 0;
    const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + Math.abs(b.result?.pnl || 0), 0) / losses.length : 0;
    const profitFactor = avgLoss > 0 ? avgWin / avgLoss : avgWin > 0 ? 999 : 0;

    const insights: Insight[] = [];
    if (successRate > 0.6) {
      insights.push({ category: 'performance', observation: 'High win rate detected', confidence: successRate, recommendation: 'Maintain current strategy parameters' });
    } else if (successRate < 0.4) {
      insights.push({ category: 'performance', observation: 'Low win rate detected', confidence: 1 - successRate, recommendation: 'Review entry and exit criteria' });
    }

    if (profitFactor > 2) {
      insights.push({ category: 'profitability', observation: 'Strong profit factor', confidence: Math.min(1, profitFactor / 3), recommendation: 'Continue current risk profile' });
    }

    return {
      id: `learning-${Date.now()}`,
      period: new Date().toISOString().slice(0, 7),
      symbol: trades[0]?.recommendation.symbol || 'UNKNOWN',
      successRate,
      avgWin,
      avgLoss,
      profitFactor,
      totalTrades: completedTrades.length,
      insights,
      improvements: [],
      lastUpdated: Date.now(),
    };
  }

  private createEmptyLearningRecord(): LearningRecord {
    return {
      id: `learning-${Date.now()}`,
      period: new Date().toISOString().slice(0, 7),
      symbol: 'UNKNOWN',
      successRate: 0,
      avgWin: 0,
      avgLoss: 0,
      profitFactor: 0,
      totalTrades: 0,
      insights: [],
      improvements: [],
      lastUpdated: Date.now(),
    };
  }
}

export class TradeResultAnalyzer {
  analyzeRiskRewardAccuracy(
    recommendation: { stopLoss?: number; takeProfit?: number; entryPrice?: number },
    result: { exitPrice: number; exitReason: string },
  ): { targetMet: boolean; slHit: boolean; ratio: number } {
    if (!recommendation.entryPrice) {
      return { targetMet: false, slHit: false, ratio: 0 };
    }

    const targetMet = !!recommendation.takeProfit &&
      ((result.exitPrice >= recommendation.takeProfit && result.exitPrice > recommendation.entryPrice) ||
        (result.exitPrice <= recommendation.takeProfit && result.exitPrice < recommendation.entryPrice));

    const slHit = !!recommendation.stopLoss &&
      Math.abs(result.exitPrice - recommendation.stopLoss) < Math.abs(result.exitPrice - recommendation.entryPrice) * 0.02;

    const expectedRR =
      recommendation.takeProfit && recommendation.stopLoss
        ? Math.abs(recommendation.takeProfit - recommendation.entryPrice) /
          Math.abs(recommendation.entryPrice - recommendation.stopLoss)
        : 0;

    return { targetMet, slHit, ratio: expectedRR };
  }

  analyzeExecutionQuality(
    recommendation: { entryPrice?: number },
    result: { executedPrice: number; targetPrice?: number },
  ): { slippage: number; quality: 'excellent' | 'good' | 'fair' | 'poor' } {
    if (!recommendation.entryPrice) {
      return { slippage: 0, quality: 'fair' };
    }

    const slippage = Math.abs(result.executedPrice - recommendation.entryPrice) / recommendation.entryPrice;

    let quality: 'excellent' | 'good' | 'fair' | 'poor';
    if (slippage < 0.001) quality = 'excellent';
    else if (slippage < 0.005) quality = 'good';
    else if (slippage < 0.01) quality = 'fair';
    else quality = 'poor';

    return { slippage, quality };
  }
}
