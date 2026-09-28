import { Injectable } from '@nestjs/common';
import { CanonicalMarketType } from '../interfaces/canonical-market.interface';

export const TRADING_COST_MODEL_VERSION = 'trading-cost-v1';

export interface TradingCostEstimate {
  available: boolean;
  version: string;
  feeRate: number | null;
  spreadFraction: number;
  slippageFraction: number;
  fundingFraction: number;
  feeCostR: number | null;
  spreadCostR: number | null;
  slippageCostR: number | null;
  fundingCostR: number | null;
  reason?: string;
}

export interface TradingCostInput {
  marketType: CanonicalMarketType;
  entryPrice: number;
  stopLoss: number;
  spreadFraction: number;
  slippageFraction: number;
  fundingRate: number | null;
  holdingTimeMs: number;
}

@Injectable()
export class TradingCostModel {
  estimate(input: TradingCostInput): TradingCostEstimate {
    const feeVariable = input.marketType === 'spot' ? 'TRADING_SPOT_TAKER_FEE_RATE' : 'TRADING_FUTURES_TAKER_FEE_RATE';
    const feeRate = Number(process.env[feeVariable]);
    const riskFraction = Math.abs(input.entryPrice - input.stopLoss) / input.entryPrice;
    if (![input.entryPrice, input.stopLoss, input.spreadFraction, input.slippageFraction, input.holdingTimeMs, feeRate]
      .every(Number.isFinite)
      || input.entryPrice <= 0 || riskFraction <= 0 || feeRate < 0
      || input.spreadFraction < 0 || input.slippageFraction < 0 || input.holdingTimeMs < 0) {
      return this.unavailable(feeRate, input.spreadFraction, input.slippageFraction, 'COST_ASSUMPTIONS_UNAVAILABLE');
    }
    if (input.marketType === 'futures' && !Number.isFinite(input.fundingRate)) {
      return this.unavailable(feeRate, input.spreadFraction, input.slippageFraction, 'FUTURES_FUNDING_UNAVAILABLE');
    }
    const fundingFraction = input.marketType === 'futures'
      ? Math.abs(input.fundingRate!) * Math.max(1, input.holdingTimeMs / (8 * 60 * 60 * 1000))
      : 0;
    return {
      available: true,
      version: TRADING_COST_MODEL_VERSION,
      feeRate,
      spreadFraction: input.spreadFraction,
      slippageFraction: input.slippageFraction,
      fundingFraction,
      feeCostR: 2 * feeRate / riskFraction,
      spreadCostR: input.spreadFraction / riskFraction,
      slippageCostR: 2 * input.slippageFraction / riskFraction,
      fundingCostR: fundingFraction / riskFraction,
    };
  }

  estimatedFees(entryPrice: number, quantity: number, feeRate: number): number {
    return 2 * Math.abs(entryPrice * quantity * feeRate);
  }

  estimatedSlippage(entryPrice: number, quantity: number, slippageFraction: number): number {
    return 2 * Math.abs(entryPrice * quantity * slippageFraction);
  }

  private unavailable(feeRate: number, spreadFraction: number, slippageFraction: number, reason: string): TradingCostEstimate {
    return {
      available: false,
      version: TRADING_COST_MODEL_VERSION,
      feeRate: Number.isFinite(feeRate) ? feeRate : null,
      spreadFraction: Number.isFinite(spreadFraction) ? spreadFraction : 0,
      slippageFraction: Number.isFinite(slippageFraction) ? slippageFraction : 0,
      fundingFraction: 0,
      feeCostR: null,
      spreadCostR: null,
      slippageCostR: null,
      fundingCostR: null,
      reason,
    };
  }
}
