jest.mock('@rfsanz/database', () => ({
  __esModule: true,
  default: {
    tradeDecisionSnapshot: { upsert: jest.fn().mockResolvedValue(undefined) },
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
});
