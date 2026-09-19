import { ExchangeReconciliationService } from '../services/exchange-reconciliation.service';

describe('ExchangeReconciliationService', () => {
  const service = new ExchangeReconciliationService();

  it('accepts equal local and exchange state', async () => {
    const result = await service.reconcileAll(
      { equity: '10000' },
      [{ clientOrderId: 'o-1', status: 'NEW', filled: '0' }],
      [{ symbol: 'BTCUSDT', side: 'BUY', quantity: '0.4' }],
    );
    expect(result.status).toBe('HEALTHY');
    expect(result.mismatches).toEqual([]);
  });

  it('detects order and position mismatches in both directions', async () => {
    const orders = await service.reconcileOrders(
      [{ clientOrderId: 'local-only', status: 'NEW', filled: '0' }],
      [{ clientOrderId: 'exchange-only', status: 'NEW', filled: '0' }],
    );
    const positions = await service.reconcilePositions(
      [{ symbol: 'ETHUSDT', side: 'BUY', quantity: '0.4' }],
      [{ symbol: 'BTCUSDT', side: 'BUY', quantity: '0.5' }],
    );
    expect(orders).toEqual(expect.arrayContaining(['orphan-exchange-order:exchange-only', 'orphan-local-order:local-only']));
    expect(positions).toEqual(expect.arrayContaining(['orphan-exchange-position:BTCUSDT', 'orphan-local-position:ETHUSDT']));
  });

  it('blocks healthy status when quantities differ', async () => {
    const result = await service.reconcileAll(
      { equity: '10000' },
      [{ clientOrderId: 'o-1', status: 'PARTIALLY_FILLED', filled: '0.3' }],
      [{ symbol: 'BTCUSDT', side: 'BUY', quantity: '0.4' }],
      { equity: '10000' },
      [{ clientOrderId: 'o-1', status: 'PARTIALLY_FILLED', filled: '0.2' }],
      [{ symbol: 'BTCUSDT', side: 'BUY', quantity: '0.5' }],
    );
    expect(result.status).toBe('DEGRADED');
    expect(result.mismatches).toEqual(expect.arrayContaining(['order-mismatch:o-1', 'position-mismatch:BTCUSDT']));
  });

  it('does not treat synthetic spot positions as orphaned without an exchange position API', async () => {
    const result = await service.reconcileAll(
      { equity: '10000' },
      [],
      [{ symbol: 'BTCUSDT', side: 'BUY', quantity: '0.00007' }],
      { equity: '10000' },
      [],
      [],
      false,
    );
    expect(result.status).toBe('HEALTHY');
    expect(result.mismatches).toEqual([]);
  });
});
