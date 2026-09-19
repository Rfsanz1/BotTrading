import { TradingService } from '../trading.service';

jest.mock('@rfsanz/database', () => ({
  __esModule: true,
  default: {
    user: { findUnique: jest.fn() },
    order: { findMany: jest.fn() },
    $transaction: jest.fn(),
  },
}));

jest.mock('@rfsanz/exchange', () => {
  const actual = jest.requireActual('@rfsanz/exchange');
  return { ...actual, createExchange: jest.fn() };
});

describe('stale local NEW order reconciliation', () => {
  it('rejects only an unsubmitted zero-fill order and records evidence', async () => {
    const order = {
      id: 'order-1',
      userId: 'user-1',
      exchange: 'binance',
      symbol: 'BTCUSDT',
      status: 'NEW',
      externalId: null,
      filled: 0,
      meta: { harness: true },
    };
    const tx = {
      order: {
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue({ ...order, status: 'REJECTED' }),
      },
      auditLog: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = require('@rfsanz/database').default;
    prisma.user.findUnique.mockResolvedValue({
      id: 'user-1',
      exchangeAccounts: [{ id: 'account-1', exchange: 'binance', isActive: true }],
    });
    prisma.order.findMany.mockResolvedValue([order]);
    prisma.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx));

    const adapter = {
      connect: jest.fn(),
      fetchOpenOrders: jest.fn().mockResolvedValue([]),
      getOrder: jest.fn().mockResolvedValue(null),
      disconnect: jest.fn(),
    };
    jest.spyOn(TradingService.prototype as any, 'resolveExecutionAccount').mockResolvedValue({
      id: 'account-1',
      exchange: 'binance',
      credentials: { apiKey: 'key', apiSecret: 'secret' },
      isActive: true,
      tradingMode: 'TESTNET',
    });
    const exchange = require('@rfsanz/exchange');
    exchange.createExchange.mockReturnValue(adapter);

    const service = new TradingService(
      { emitAsync: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    await service.reconcileOpenOrders('user-1', 'binance');

    expect(tx.order.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'order-1' },
      data: expect.objectContaining({ status: 'REJECTED' }),
    }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ action: 'ORDER_RECONCILIATION_REJECTED' }),
    }));
    expect(adapter.getOrder).not.toHaveBeenCalled();
  });
});
