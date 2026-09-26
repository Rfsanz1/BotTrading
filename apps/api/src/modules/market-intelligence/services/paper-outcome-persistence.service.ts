import { Injectable } from '@nestjs/common';
import prisma from '@rfsanz/database';
import type { Prisma } from '@prisma/client';

export interface PaperPredictionInput {
  decisionId: string;
  snapshotId?: string;
  symbol: string;
  marketType: 'spot' | 'futures';
  provider: string;
  model: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  setupType: string;
  timeframe: string;
  confidenceRaw: number;
  calibratedProbability: number | null;
  regime: string;
  opportunityScore: number;
  decisionTimestamp?: number;
  entryPrice?: number | null;
  stopLoss?: number | null;
  takeProfit?: number | null;
  riskReward?: number | null;
  spread?: number | null;
  dataQuality?: unknown;
  signalFactors?: unknown;
  strategyVersion?: string;
}

export interface PaperOutcomeInput {
  decisionId: string;
  entryPrice: number;
  exitPrice: number;
  realizedPnL: number;
  returnPct: number;
  mfe: number;
  mae: number;
  holdingTime: number;
  fees: number;
  slippage: number;
  fundingCost: number;
  exitReason: string;
  winLoss: 'win' | 'loss' | 'neutral';
  closedAt?: number;
}

export interface CalibrationBucket {
  bucket: string;
  sampleCount: number;
  wins: number;
  losses: number;
  empiricalWinRate: number | null;
  averageReturn: number | null;
  brierContribution: number | null;
}

@Injectable()
export class PaperOutcomePersistenceService {
  async recordPrediction(input: PaperPredictionInput): Promise<void> {
    await prisma.tradeDecisionSnapshot.upsert({
      where: { decisionId: input.decisionId },
      create: {
        decisionId: input.decisionId,
        timestamp: new Date(),
        symbol: input.symbol,
        exchange: input.marketType,
        timeframe: input.timeframe,
        regime: input.regime,
        setup: input.setupType,
        rawConfidence: input.confidenceRaw,
        calibratedProbability: input.calibratedProbability,
        calibrationStatus: input.calibratedProbability === null ? 'INSUFFICIENT_DATA' : 'CALIBRATED',
        expectedValue: null,
        expectedValueAfterCost: null,
        decision: input.direction,
        featureSnapshot: { marketType: input.marketType, opportunityScore: input.opportunityScore },
        aiOutputs: { provider: input.provider, model: input.model },
        entry: input.entryPrice,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        riskReward: input.riskReward,
        strategyVersion: input.strategyVersion ?? 'paper-forward-v1',
        marketSnapshot: this.snapshotJson(input),
      },
      update: {
        rawConfidence: input.confidenceRaw,
        calibratedProbability: input.calibratedProbability,
        calibrationStatus: input.calibratedProbability === null ? 'INSUFFICIENT_DATA' : 'CALIBRATED',
        featureSnapshot: { marketType: input.marketType, opportunityScore: input.opportunityScore },
        aiOutputs: { provider: input.provider, model: input.model },
        entry: input.entryPrice,
        stopLoss: input.stopLoss,
        takeProfit: input.takeProfit,
        riskReward: input.riskReward,
        strategyVersion: input.strategyVersion ?? 'paper-forward-v1',
        marketSnapshot: this.snapshotJson(input),
      },
    });
  }

  async recordOutcome(input: PaperOutcomeInput): Promise<void> {
    await prisma.tradeOutcome.upsert({
      where: { decisionId: input.decisionId },
      create: {
        decisionId: input.decisionId,
        entryPrice: input.entryPrice,
        exitPrice: input.exitPrice,
        realizedPnL: input.realizedPnL,
        realizedR: null,
        fees: input.fees,
        slippage: input.slippage,
        mfe: input.mfe,
        mae: input.mae,
        holdingTime: input.holdingTime,
        exitReason: input.exitReason,
        winLoss: input.winLoss,
        closedAt: input.closedAt ? new Date(input.closedAt) : new Date(),
      },
      update: {
        exitPrice: input.exitPrice,
        realizedPnL: input.realizedPnL,
        fees: input.fees,
        slippage: input.slippage,
        mfe: input.mfe,
        mae: input.mae,
        holdingTime: input.holdingTime,
        exitReason: input.exitReason,
        winLoss: input.winLoss,
        closedAt: input.closedAt ? new Date(input.closedAt) : new Date(),
      },
    });
  }

  private snapshotJson(input: PaperPredictionInput): Prisma.InputJsonValue {
    return {
      decisionTimestamp: input.decisionTimestamp ?? Date.now(),
      spread: input.spread ?? null,
      dataQuality: input.dataQuality ? JSON.parse(JSON.stringify(input.dataQuality)) : null,
      signalFactors: input.signalFactors ? JSON.parse(JSON.stringify(input.signalFactors)) : null,
    } as Prisma.InputJsonValue;
  }

  async calibration(minimumSamples = 30): Promise<{
    sampleCount: number;
    calibratedProbability: number | null;
    brierScore: number | null;
    calibrationError: number | null;
    buckets: CalibrationBucket[];
  }> {
    const rows = await prisma.tradeDecisionSnapshot.findMany({
      where: { rawConfidence: { not: null }, outcome: { isNot: null } },
      select: { rawConfidence: true, outcome: { select: { winLoss: true, realizedPnL: true } } },
    });
    const completed = rows.filter((row) => row.outcome?.winLoss === 'win' || row.outcome?.winLoss === 'loss');
    const buckets = [0.5, 0.55, 0.6, 0.65, 0.7, 0.75, 0.8, 0.85, 0.9, 0.95].map((lower, index, values) => {
      const upper = values[index + 1] ?? 1.01;
      const matches = completed.filter((row) => Number(row.rawConfidence) >= lower && Number(row.rawConfidence) < upper);
      const wins = matches.filter((row) => row.outcome?.winLoss === 'win').length;
      const losses = matches.filter((row) => row.outcome?.winLoss === 'loss').length;
      const empirical = matches.length ? wins / matches.length : null;
      return {
        bucket: `${lower.toFixed(2)}-${Math.min(1, upper).toFixed(2)}`,
        sampleCount: matches.length,
        wins,
        losses,
        empiricalWinRate: empirical,
        averageReturn: matches.length ? matches.reduce((sum, row) => sum + Number(row.outcome?.realizedPnL ?? 0), 0) / matches.length : null,
        brierContribution: empirical === null ? null : matches.reduce((sum, row) => sum + (Number(row.rawConfidence) - (row.outcome?.winLoss === 'win' ? 1 : 0)) ** 2, 0) / matches.length,
      };
    });
    if (completed.length < minimumSamples) return { sampleCount: completed.length, calibratedProbability: null, brierScore: null, calibrationError: null, buckets };
    const probability = completed.reduce((sum, row) => sum + Number(row.outcome?.winLoss === 'win'), 0) / completed.length;
    const brierScore = completed.reduce((sum, row) => sum + (probability - Number(row.outcome?.winLoss === 'win')) ** 2, 0) / completed.length;
    const calibrationError = buckets.filter((bucket) => bucket.empiricalWinRate !== null)
      .reduce((sum, bucket) => sum + Math.abs(bucket.empiricalWinRate! - probability), 0) / Math.max(1, buckets.filter((bucket) => bucket.empiricalWinRate !== null).length);
    return { sampleCount: completed.length, calibratedProbability: probability, brierScore, calibrationError, buckets };
  }
}
