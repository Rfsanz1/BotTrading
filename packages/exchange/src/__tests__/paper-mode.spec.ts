import { FakePaperExchangeAdapter } from '../adapters/fake-paper.adapter';

describe('paper exchange adapter', () => {
  it('accepts and settles a deterministic paper order', async () => {
    const adapter = new FakePaperExchangeAdapter({
      id: 'paper-acct',
      userId: 'user-p',
      exchange: 'paper',
      isActive: true,
      isPaper: true,
    }, { fillMode: 'partial', partialFillRatio: 0.5 });

    await adapter.connect({
      id: 'paper-acct',
      userId: 'user-p',
      exchange: 'paper',
      isActive: true,
      isPaper: true,
    });

    const placed = await adapter.placeOrder({
      symbol: 'BTCUSDT',
      side: 'buy',
      type: 'limit',
      quantity: '1',
      price: '50000',
      clientOrderId: 'paper-order-1',
    });

    expect(placed.status).toBe('PARTIALLY_FILLED');
    expect(placed.filled).toBe('0.5');

    const openOrders = await adapter.fetchOpenOrders('BTCUSDT');
    expect(openOrders.length).toBeGreaterThanOrEqual(1);
  });

  it('supports deterministic rejection and cancellation states', async () => {
    const adapter = new FakePaperExchangeAdapter(undefined, { fillMode: 'reject' });
    await adapter.connect({
      id: 'paper-acct-2',
      userId: 'user-p2',
      exchange: 'paper',
      isActive: true,
      isPaper: true,
    });

    const rejected = await adapter.placeOrder({
      symbol: 'ETHUSDT',
      side: 'sell',
      type: 'limit',
      quantity: '2',
      price: '2500',
      clientOrderId: 'paper-order-2',
    });

    expect(rejected.status).toBe('REJECTED');

    const cancelledAdapter = new FakePaperExchangeAdapter(undefined, { fillMode: 'cancelled' });
    await cancelledAdapter.connect({
      id: 'paper-acct-3',
      userId: 'user-p3',
      exchange: 'paper',
      isActive: true,
      isPaper: true,
    });

    const cancelled = await cancelledAdapter.placeOrder({
      symbol: 'SOLUSDT',
      side: 'buy',
      type: 'limit',
      quantity: '10',
      price: '150',
      clientOrderId: 'paper-order-3',
    });

    expect(cancelled.status).toBe('CANCELED');
  });
});
