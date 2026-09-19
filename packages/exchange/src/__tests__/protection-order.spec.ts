import { ProtectionOrderService } from '../services/protection-order.service';
import { IExchange } from '../IExchange';

function exchange(overrides: Partial<IExchange> = {}): IExchange {
  return {
    name: 'binance',
    connect: jest.fn(),
    disconnect: jest.fn(),
    fetchBalances: jest.fn(),
    fetchTicker: jest.fn(),
    placeOrder: jest.fn(),
    cancelOrder: jest.fn(),
    getOrder: jest.fn(),
    fetchOpenOrders: jest.fn(),
    fetchOpenPositions: jest.fn(),
    subscribeTicker: jest.fn(),
    unsubscribeTicker: jest.fn(),
    ...overrides,
  } as IExchange;
}

const params = {
  symbol: 'BTCUSDT',
  side: 'sell' as const,
  quantity: '0.01',
  triggerPrice: '40000',
  limitPrice: '39900',
  clientOrderId: 'bt-protection-1',
  kind: 'STOP_LOSS' as const,
};

const acknowledged = {
  id: '100',
  externalId: '100',
  clientOrderId: params.clientOrderId,
  symbol: params.symbol,
  side: params.side,
  quantity: params.quantity,
  triggerPrice: params.triggerPrice,
  limitPrice: params.limitPrice,
  kind: params.kind,
  status: 'NEW',
  state: 'CONFIRMED' as const,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe('ProtectionOrderService', () => {
  it('creates stop-loss and take-profit orders only after acknowledgement', async () => {
    const service = new ProtectionOrderService();
    const createProtectionOrder = jest.fn().mockResolvedValue(acknowledged);
    const result = await service.create(exchange({ createProtectionOrder }), params);
    expect(result.state).toBe('CONFIRMED');
    expect(createProtectionOrder).toHaveBeenCalledWith(params);
  });

  it('fails closed on rejection and marks timeout unknown', async () => {
    const service = new ProtectionOrderService();
    await expect(service.create(exchange({
      createProtectionOrder: jest.fn().mockRejectedValue(new Error('rejected by exchange')),
      getProtectionOrder: jest.fn().mockResolvedValue(null),
    }), params)).rejects.toThrow(/failed/i);
    await expect(service.create(exchange({
      createProtectionOrder: jest.fn().mockRejectedValue(new Error('timeout after submit')),
      getProtectionOrder: jest.fn().mockResolvedValue(null),
    }), { ...params, clientOrderId: 'bt-protection-timeout' })).rejects.toThrow(/unknown/i);
  });

  it('reconciles an order found after an ambiguous response', async () => {
    const service = new ProtectionOrderService();
    const getProtectionOrder = jest.fn().mockResolvedValue(acknowledged);
    const result = await service.create(exchange({
      createProtectionOrder: jest.fn().mockRejectedValue(new Error('timeout')),
      getProtectionOrder,
    }), params);
    expect(result.state).toBe('CONFIRMED');
    expect(getProtectionOrder).toHaveBeenCalled();
  });

  it('blocks duplicates, supports amend/cancel, and reconciles restart state', async () => {
    const service = new ProtectionOrderService();
    const ex = exchange({
      createProtectionOrder: jest.fn().mockResolvedValue(acknowledged),
      amendProtectionOrder: jest.fn().mockResolvedValue({ ...acknowledged, triggerPrice: '40100' }),
      cancelProtectionOrder: jest.fn().mockResolvedValue(undefined),
      getProtectionOrder: jest.fn().mockResolvedValue(acknowledged),
    });
    await service.create(ex, params);
    await expect(service.create(ex, params)).rejects.toThrow(/Duplicate/);
    expect((await service.amend(ex, params.clientOrderId, { triggerPrice: '40100' })).state).toBe('CONFIRMED');
    expect((await service.reconcile(ex, params.clientOrderId)).state).toBe('CONFIRMED');
    expect((await service.cancel(ex, params.clientOrderId)).state).toBe('CANCELED');
  });
});
