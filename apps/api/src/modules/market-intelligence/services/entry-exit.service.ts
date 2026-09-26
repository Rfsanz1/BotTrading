import { Injectable } from '@nestjs/common';

export interface EntryExitInput {
  direction: 'LONG' | 'SHORT';
  price: number;
  spread: number;
  atr: number | null;
  structureInvalidation: number | null;
  liquidityTargets: number[];
  structureTargets: number[];
}

export interface EntryExitResult {
  entryZone: { low: number; high: number };
  preferredEntry: number;
  entryType: 'MARKET' | 'LIMIT' | 'BREAKOUT' | 'RETEST' | 'PULLBACK' | 'RECLAIM';
  stopLoss: number | null;
  invalidation: number | null;
  invalidationReason: string;
  tp1: { price: number; expectedR: number; targetReason: string } | null;
  tp2: { price: number; expectedR: number; targetReason: string } | null;
  tp3: { price: number; expectedR: number; targetReason: string } | null;
}

@Injectable()
export class EntryExitService {
  calculate(input: EntryExitInput): EntryExitResult {
    if (!Number.isFinite(input.price) || input.price <= 0 || !Number.isFinite(input.spread) || input.spread < 0) {
      throw new Error('Invalid entry/exit market input');
    }
    const buffer = Math.max(input.spread, input.atr ? input.atr * 0.1 : input.price * 0.0005);
    const stopLoss = input.structureInvalidation === null ? null
      : input.direction === 'LONG' ? input.structureInvalidation - buffer : input.structureInvalidation + buffer;
    const risk = stopLoss === null ? null : Math.abs(input.price - stopLoss);
    const targets = [...input.liquidityTargets, ...input.structureTargets]
      .filter((value) => Number.isFinite(value))
      .filter((value) => input.direction === 'LONG' ? value > input.price : value < input.price)
      .sort((a, b) => input.direction === 'LONG' ? a - b : b - a)
      .filter((value, index, values) => index === 0 || Math.abs(value - values[index - 1]) > Number.EPSILON);
    const target = (value: number | undefined, reason: string) => value === undefined || risk === null || risk <= 0 ? null : {
      price: value,
      expectedR: Math.abs(value - input.price) / risk,
      targetReason: reason,
    };
    return {
      entryZone: { low: input.price - input.spread / 2, high: input.price + input.spread / 2 },
      preferredEntry: input.price,
      entryType: input.spread > input.price * 0.001 ? 'LIMIT' : 'MARKET',
      stopLoss,
      invalidation: input.structureInvalidation,
      invalidationReason: input.structureInvalidation === null ? 'STRUCTURE_INVALIDATION_UNAVAILABLE' : 'STRUCTURE_LEVEL_WITH_EXECUTION_BUFFER',
      tp1: target(targets[0], 'LIQUIDITY'),
      tp2: target(targets[1], 'STRUCTURE'),
      tp3: target(targets[2], 'EXPANSION'),
    };
  }
}
