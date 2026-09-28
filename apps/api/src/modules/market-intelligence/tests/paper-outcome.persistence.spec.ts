jest.mock('@rfsanz/database', () => ({
  __esModule: true,
  default: {
    tradeDecisionSnapshot: {
      upsert: jest.fn().mockResolvedValue(undefined),
      findMany: jest.fn().mockResolvedValue([]),
    },
    tradeOutcome: { upsert: jest.fn().mockResolvedValue(undefined) },
  },
}));

import prisma from '@rfsanz/database';
import { PaperOutcomePersistenceService } from '../services/paper-outcome-persistence.service';

describe('paper outcome persistence', () => {
  it('upserts the same decision outcome idempotently on replay', async () => {
    const service = new PaperOutcomePersistenceService();
    const input = {
      decisionId: 'decision-replay',
      entryPrice: 100,
      exitPrice: 105,
      realizedPnL: 5,
      returnPct: 1,
      mfe: 5,
      mae: 0,
      holdingTime: 1_000,
      fees: 0.2,
      slippage: 0.1,
      fundingCost: 0,
      exitReason: 'TAKE_PROFIT',
      winLoss: 'win' as const,
      closedAt: 2_000,
    };

    await service.recordOutcome(input);
    await service.recordOutcome(input);

    expect(prisma.tradeOutcome.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.tradeOutcome.upsert).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { decisionId: 'decision-replay' },
      create: expect.objectContaining({ decisionId: 'decision-replay' }),
    }));
    expect(prisma.tradeOutcome.upsert).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: { decisionId: 'decision-replay' },
      update: expect.objectContaining({ exitReason: 'TAKE_PROFIT' }),
    }));
  });

  it('calibrates only from confidence-bucket outcomes closed by the decision timestamp', async () => {
    const rows = Array.from({ length: 30 }, (_, index) => ({ outcome: { winLoss: index < 21 ? 'win' : 'loss' } }));
    (prisma.tradeDecisionSnapshot.findMany as jest.Mock).mockResolvedValue(rows);
    const service = new PaperOutcomePersistenceService();

    await expect(service.calibrateConfidenceBucket(0.72, 10_000, 30))
      .resolves.toEqual({ sampleSize: 30, calibratedProbability: 0.7 });
    expect(prisma.tradeDecisionSnapshot.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        timestamp: { lte: new Date(10_000) },
        rawConfidence: { gte: 0.7, lt: 0.75 },
        outcome: { is: { closedAt: { lte: new Date(10_000) }, winLoss: { in: ['win', 'loss'] } } },
      }),
    }));
  });

  it('does not produce a probability below the configured outcome sample minimum', async () => {
    (prisma.tradeDecisionSnapshot.findMany as jest.Mock).mockResolvedValue([
      { outcome: { winLoss: 'win' } },
      { outcome: { winLoss: 'loss' } },
    ]);

    await expect(new PaperOutcomePersistenceService().calibrateConfidenceBucket(0.72, 10_000, 30))
      .resolves.toEqual({ sampleSize: 2, calibratedProbability: null });
  });
});
