import { buildCanonicalClientOrderId, ExecutionEngine } from '../services/execution-engine';

describe('ExecutionEngine', () => {
  const engine = new ExecutionEngine();

  it('builds Binance-valid deterministic client order IDs', () => {
    const first = buildCanonicalClientOrderId('decision-123');
    const second = buildCanonicalClientOrderId('decision-123');
    const distinct = buildCanonicalClientOrderId('decision-124');

    expect(first).toBe(second);
    expect(first).not.toBe(distinct);
    expect(first).toMatch(/^[A-Za-z0-9_-]{1,36}$/);
    expect(first).toHaveLength(35);
  });

  it('keeps realistic local identities collision-resistant and replay-compatible', () => {
    const decisionId = 'bfaa31d2-9e0d-44a5-9910-d00f78ad0054';
    const first = engine.buildClientOrderId(decisionId);
    const replay = engine.buildClientOrderId(decisionId);
    const versioned = engine.buildClientOrderId(decisionId, 'v2');

    expect(first).toBe(replay);
    expect(first).not.toBe(versioned);
    expect(engine.dedupeKey({
      decisionId,
      clientOrderId: first,
      symbol: 'BTCUSDT',
    })).toBe(`${decisionId}:${first}:BTCUSDT`);
  });

  it('allows a valid order state progression', () => {
    const record = engine.createOrderRecord({
      decisionId: 'decision-1',
      riskDecisionId: 'risk-1',
      authorizationId: 'auth-1',
      accountId: 'acct-1',
      exchange: 'binance',
      symbol: 'BTCUSDT',
      side: 'BUY',
      requestedQuantity: 1,
      approvedQuantity: 1,
      requestedPrice: 100,
    });

    const submitting = engine.transition(record, 'SUBMITTING');
    const accepted = engine.transition(submitting, 'ACCEPTED');
    const partial = engine.transition(accepted, 'PARTIALLY_FILLED', { filledQuantity: 0.4, remainingQuantity: 0.6 });
    const filled = engine.transition(partial, 'FILLED', { filledQuantity: 1, remainingQuantity: 0 });

    expect(filled.status).toBe('FILLED');
    expect(filled.remainingQuantity).toBe(0);
  });

  it('rejects invalid state transitions', () => {
    const record = engine.createOrderRecord({
      decisionId: 'decision-2',
      riskDecisionId: 'risk-2',
      authorizationId: 'auth-2',
      accountId: 'acct-2',
      exchange: 'binance',
      symbol: 'ETHUSDT',
      side: 'SELL',
      requestedQuantity: 2,
      approvedQuantity: 2,
    });

    expect(() => engine.transition(record, 'FILLED')).toThrow(/Invalid order transition/);
  });

  it('rejects expired authorization', () => {
    const expiredAuth = {
      status: 'APPROVED' as const,
      decisionId: 'decision-3',
      riskDecisionId: 'risk-3',
      symbol: 'BTCUSDT',
      side: 'BUY' as const,
      quantity: 1,
      entry: 100,
      mode: 'TESTNET' as const,
      accountId: 'acct-3',
      issuedAt: Date.now() - 60000,
      expiresAt: Date.now() - 1000,
      riskVersion: 'risk-v1',
    };

    expect(engine.verifyAuthorization(expiredAuth, {
      decisionId: 'decision-3',
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 1,
      entry: 100,
      riskDecisionId: 'risk-3',
      riskVersion: 'risk-v1',
    })).toBe(false);
  });

  it('blocks new order when an active order already exists for the decision', () => {
    const record = engine.createOrderRecord({
      decisionId: 'decision-4',
      riskDecisionId: 'risk-4',
      authorizationId: 'auth-4',
      accountId: 'acct-4',
      exchange: 'binance',
      symbol: 'SOLUSDT',
      side: 'BUY',
      requestedQuantity: 3,
      approvedQuantity: 3,
    });

    const active = engine.transition(engine.transition(record, 'SUBMITTING'), 'ACCEPTED');
    expect(engine.shouldBlockNewOrder(active)).toBe(true);
  });
});
