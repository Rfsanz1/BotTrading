import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../../common/prisma.service';
import { MarketRepository } from '../repositories/market-repository';

const describeIfDatabase = process.env.DATABASE_URL ? describe : describe.skip;

describeIfDatabase('MarketRepository JSONB persistence', () => {
  const prisma = new PrismaService();
  const repository = new MarketRepository(prisma);
  const ids: string[] = [];

  beforeAll(async () => {
    await prisma.$connect();
  });

  afterAll(async () => {
    if (ids.length > 0) {
      await prisma.marketSnapshot.deleteMany({ where: { id: { in: ids } } });
    }
    await prisma.$disconnect();
  });

  it('persists nested objects and arrays as structured JSONB and reads them back', async () => {
    const id = `jsonb-test-${randomUUID()}`;
    ids.push(id);
    const payload = {
      source: { venue: 'test', feeds: ['ticker', 'orderbook'] },
      candles: [{ close: 100.25, volume: 12 }, { close: 100.5, volume: 15 }],
      optional: null,
    };
    const normalized = {
      indicators: { trend: 'UP', levels: [100, 101] },
      flags: [true, false],
    };

    await repository.createSnapshot({
      id,
      symbol: 'JSONBTEST',
      timeframe: '1m',
      source: 'integration-test',
      payload,
      normalized,
    });

    const [stored] = await repository.findRecent('JSONBTEST', '1m', 'integration-test');
    assert.deepEqual(stored.payload, payload);
    assert.deepEqual(stored.normalized, normalized);
    assert.equal(typeof stored.payload, 'object');
    assert.ok(Array.isArray(stored.payload.candles));
  });

  it('updates JSONB fields without converting them to text', async () => {
    const id = `jsonb-update-${randomUUID()}`;
    ids.push(id);
    await repository.createSnapshot({
      id,
      symbol: 'JSONBTEST',
      timeframe: '5m',
      source: 'integration-test',
      payload: { version: 1 },
      normalized: { version: 1 },
    });

    const updatedPayload = { version: 2, nested: { values: [1, 2, 3] } };
    await repository.updateSnapshot(id, { payload: updatedPayload });
    const [stored] = await repository.findRecent('JSONBTEST', '5m', 'integration-test');

    assert.deepEqual(stored.payload, updatedPayload);
    assert.deepEqual(stored.normalized, { version: 1 });
  });

  it('rejects non-JSON-safe payloads without writing a row', async () => {
    const id = `jsonb-invalid-${randomUUID()}`;
    ids.push(id);
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    await assert.rejects(
      repository.createSnapshot({
        id,
        symbol: 'JSONBTEST',
        timeframe: '15m',
        source: 'integration-test',
        payload: circular,
        normalized: { valid: true },
      }),
    );

    const stored = await prisma.marketSnapshot.findUnique({ where: { id } });
    assert.equal(stored, null);
  });
});
