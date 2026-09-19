import { ExecutionConfirmationService, isTrustedExecutionConfirmation } from '../services/execution-confirmation.service';
import { Order } from '../types';

describe('ExecutionConfirmationService', () => {
  const service = new ExecutionConfirmationService();
  const local = {
    orderId: 'local-order',
    decisionId: 'decision-1',
    externalOrderId: 'external-order',
    account: {
      id: 'account-1',
      userId: 'user-1',
      exchange: 'binance',
      isActive: true,
      tradingMode: 'PAPER' as const,
    },
    symbol: 'BTCUSDT',
    side: 'BUY' as const,
    quantity: 2,
  };
  const exchangeOrder: Order = {
    id: 'external-order',
    externalId: 'external-order',
    symbol: 'BTCUSDT',
    side: 'buy',
    quantity: '2',
    filled: '2',
    status: 'FILLED',
    price: '45000',
    createdAt: new Date(),
  };

  it('brands only confirmations built from executable exchange state', () => {
    const confirmation = service.fromExchangeOrder(local, exchangeOrder);
    expect(isTrustedExecutionConfirmation(confirmation)).toBe(true);
    expect(isTrustedExecutionConfirmation({ ...confirmation })).toBe(false);
  });

  it.each(['NEW', 'CANCELED', 'REJECTED', 'UNKNOWN'])('rejects non-executable status %s', (status) => {
    expect(() => service.fromExchangeOrder(local, { ...exchangeOrder, status })).toThrow();
  });

  it('uses cumulative exchange quantity and rejects fabricated overfills', () => {
    expect(service.fromExchangeOrder(local, { ...exchangeOrder, filled: '1' }).cumulativeExecutedQuantity).toBe(1);
    expect(() => service.fromExchangeOrder(local, { ...exchangeOrder, filled: '3' })).toThrow();
  });

  it('preserves authoritative fill identity, price, and fee', () => {
    const confirmation = service.fromExchangeOrder(local, {
      ...exchangeOrder,
      price: '78310.36',
      meta: {
        exchangeOrderId: '367647',
        exchangeTradeId: '71936',
        averagePrice: 78307.55,
        fee: 0,
      },
    });
    expect(confirmation.exchangeTradeId).toBe('71936');
    expect(confirmation.averageExecutionPrice).toBe(78307.55);
    expect(confirmation.executionId).toBe('external-order:71936');
  });

  it('rejects identity mismatches', () => {
    const confirmation = service.fromExchangeOrder(local, exchangeOrder);
    const expected = {
      orderId: local.orderId,
      decisionId: local.decisionId,
      externalOrderId: local.externalOrderId,
      accountId: local.account.id,
      exchange: local.account.exchange,
      symbol: local.symbol,
      side: local.side,
      quantity: local.quantity,
    };
    expect(service.verify({ ...confirmation, symbol: 'ETHUSDT' }, expected)).toBe(false);
    expect(service.verify({ ...confirmation, decisionId: 'other' }, expected)).toBe(false);
    expect(service.verify({ ...confirmation, accountId: 'other' }, expected)).toBe(false);
  });
});
