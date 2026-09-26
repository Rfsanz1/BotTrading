import { Injectable } from '@nestjs/common';

export interface ExpectedValueInput {
  calibratedProbability: number | null;
  expectedReward: number;
  expectedLoss: number;
  fee: number;
  spread: number;
  slippage: number;
  funding: number;
  holdingTimeMs: number;
  executionQuality: 'EXCELLENT' | 'GOOD' | 'DEGRADED' | 'UNSAFE';
}

export interface ExpectedValueResult {
  available: boolean;
  grossEV: number | null;
  feeCost: number | null;
  spreadCost: number | null;
  slippageCost: number | null;
  fundingCost: number | null;
  netEV: number | null;
  reason?: string;
}

@Injectable()
export class ExpectedValueService {
  calculate(input: ExpectedValueInput): ExpectedValueResult {
    if (input.calibratedProbability === null) return { available: false, grossEV: null, feeCost: null, spreadCost: null, slippageCost: null, fundingCost: null, netEV: null, reason: 'CALIBRATED_PROBABILITY_UNAVAILABLE' };
    if (![input.expectedReward, input.expectedLoss, input.fee, input.spread, input.slippage, input.funding].every(Number.isFinite)
      || input.executionQuality === 'UNSAFE') {
      return { available: false, grossEV: null, feeCost: null, spreadCost: null, slippageCost: null, fundingCost: null, netEV: null, reason: 'EXECUTION_UNSAFE' };
    }
    const grossEV = input.calibratedProbability * input.expectedReward - (1 - input.calibratedProbability) * input.expectedLoss;
    const feeCost = Math.abs(input.fee);
    const spreadCost = Math.abs(input.spread);
    const slippageCost = Math.abs(input.slippage);
    const fundingCost = Math.abs(input.funding) * Math.max(1, input.holdingTimeMs / (8 * 60 * 60 * 1000));
    return { available: true, grossEV, feeCost, spreadCost, slippageCost, fundingCost, netEV: grossEV - feeCost - spreadCost - slippageCost - fundingCost };
  }
}
