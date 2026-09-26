import prisma from '@rfsanz/database';
import { PaperOutcomePersistenceService } from '../modules/market-intelligence/services/paper-outcome-persistence.service';

const describeIfDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDatabase('isolated paper persistence and calibration', () => {
  const persistence = new PaperOutcomePersistenceService();
  const decisionIds: string[] = [];

  afterAll(async () => {
    await prisma.tradeOutcome.deleteMany({ where: { decisionId: { in: decisionIds } } });
    await prisma.tradeDecisionSnapshot.deleteMany({ where: { decisionId: { in: decisionIds } } });
    await prisma.$disconnect();
  });

  it('persists an idempotent prediction/outcome join and preserves null calibration', async () => {
    const decisionId = `paper-cert-${Date.now()}`;
    decisionIds.push(decisionId);
    await persistence.recordPrediction({
      decisionId,
      symbol: 'CERTUSDT',
      marketType: 'futures',
      provider: 'fixture',
      model: 'fixture-model',
      direction: 'LONG',
      setupType: 'BREAKOUT',
      timeframe: '5m',
      confidenceRaw: 0.7,
      calibratedProbability: null,
      regime: 'TREND',
      opportunityScore: 0.8,
    });
    await persistence.recordOutcome({
      decisionId,
      entryPrice: 100,
      exitPrice: 102,
      realizedPnL: 2,
      returnPct: 0.02,
      mfe: 3,
      mae: 0.5,
      holdingTime: 60_000,
      fees: 0.1,
      slippage: 0.01,
      fundingCost: 0,
      exitReason: 'TP1',
      winLoss: 'win',
    });
    await persistence.recordOutcome({
      decisionId,
      entryPrice: 100,
      exitPrice: 102.5,
      realizedPnL: 2.5,
      returnPct: 0.025,
      mfe: 3,
      mae: 0.5,
      holdingTime: 60_000,
      fees: 0.1,
      slippage: 0.01,
      fundingCost: 0,
      exitReason: 'TP1',
      winLoss: 'win',
    });
    const row = await prisma.tradeDecisionSnapshot.findUnique({ where: { decisionId }, include: { outcome: true } });
    expect(row?.outcome?.realizedPnL?.toString()).toBe('2.5');
    expect(row?.outcome?.winLoss).toBe('win');
    expect(row?.calibratedProbability).toBeNull();
  });

  it('enforces minimum calibration samples and calculates historical calibration after threshold', async () => {
    await prisma.tradeOutcome.deleteMany({ where: { decision: { symbol: { in: ['CERTUSDT', 'CALIBUSDT'] } } } });
    await prisma.tradeDecisionSnapshot.deleteMany({ where: { symbol: { in: ['CERTUSDT', 'CALIBUSDT'] } } });
    for (let index = 0; index < 30; index += 1) {
      const decisionId = `calibration-cert-${Date.now()}-${index}`;
      decisionIds.push(decisionId);
      await persistence.recordPrediction({
        decisionId,
        symbol: 'CALIBUSDT',
        marketType: 'spot',
        provider: 'fixture',
        model: 'fixture-model',
        direction: 'LONG',
        setupType: 'BREAKOUT',
        timeframe: '1m',
        confidenceRaw: 0.7,
        calibratedProbability: null,
        regime: 'TREND',
        opportunityScore: 0.7,
      });
      await persistence.recordOutcome({
        decisionId,
        entryPrice: 100,
        exitPrice: index < 21 ? 101 : 99,
        realizedPnL: index < 21 ? 1 : -1,
        returnPct: index < 21 ? 0.01 : -0.01,
        mfe: 1,
        mae: 1,
        holdingTime: 60_000,
        fees: 0,
        slippage: 0,
        fundingCost: 0,
        exitReason: index < 21 ? 'TP1' : 'SL',
        winLoss: index < 21 ? 'win' : 'loss',
      });
    }
    const result = await persistence.calibration(30);
    expect(result.sampleCount).toBeGreaterThanOrEqual(30);
    expect(result.calibratedProbability).toBeCloseTo(0.7, 6);
    expect(result.brierScore).not.toBeNull();
    expect(result.buckets.find((bucket) => bucket.bucket === '0.70-0.75')?.sampleCount).toBeGreaterThanOrEqual(30);
  });
});
