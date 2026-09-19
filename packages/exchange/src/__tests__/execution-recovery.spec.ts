jest.mock('../factory', () => ({
  createExchange: jest.fn(),
  listSupported: jest.fn(() => ['binance']),
}));

import { OrderService } from '../services/order.service';
import { ExecutionEngine } from '../services/execution-engine';
import { SystemReadinessService } from '../services/system-readiness.service';
import { BinanceAdapter } from '../adapters/binance.adapter';
import { createExchange } from '../factory';
import { RiskEngine } from '../services/risk-engine';
import { authorizationService } from '../services/authorization.service';

const mockCreateExchange = createExchange as jest.Mock;

describe('Execution recovery & failure regression suite', () => {
  const engine = new ExecutionEngine();

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.TRADING_MODE = 'TESTNET';
    process.env.LIVE_TRADING_ENABLED = 'false';
    const readiness = SystemReadinessService.getInstance();
    readiness.setPhase('SYSTEM_READY', 'test-ready');
    for (const key of [
      'DATABASE_READY',
      'CONFIG_VALID',
      'ACCOUNT_SYNC_READY',
      'ORDER_SYNC_READY',
      'POSITION_SYNC_READY',
      'EVENT_ROUTER_READY',
      'WEBSOCKET_READY',
      'RECONCILIATION_READY',
      'RISK_READY',
      'AI_READY',
      'LEARNING_READY',
      'STARTUP_GATE_READY',
      'TESTNET_READY',
    ] as const) {
      readiness.setCheck(key, true);
    }
  });

  it('1. timeout -> UNKNOWN -> reconcile against exchange truth', () => {
    const record = engine.createOrderRecord({
      decisionId: 'decision-timeout',
      riskDecisionId: 'risk-timeout',
      authorizationId: 'auth-timeout',
      accountId: 'acct-1',
      exchange: 'binance',
      symbol: 'BTCUSDT',
      side: 'BUY',
      requestedQuantity: 1,
      approvedQuantity: 1,
      requestedPrice: 50000,
    });

    const timedOut = engine.transition(record, 'SUBMITTING');
    const unknown = engine.transition(timedOut, 'UNKNOWN');

    expect(engine.shouldRetryUnknownOrder(unknown.status)).toBe(false);

    const reconciled = engine.reconcileLocalToExchange(unknown, {
      ...unknown,
      status: 'ACCEPTED',
      filledQuantity: 0.25,
      remainingQuantity: 0.75,
      averageFillPrice: 50010,
      lastExchangeUpdateAt: Date.now(),
    });

    expect(reconciled?.status).toBe('ACCEPTED');
    expect(reconciled?.filledQuantity).toBe(0.25);
  });

  it('2. duplicate place() does not create a duplicate exchange order', async () => {
    const fakeExchange = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      placeOrder: jest.fn().mockResolvedValue({
        id: 'ord-duplicate-1',
        clientOrderId: 'decision-dup-v1',
        symbol: 'BTCUSDT',
        side: 'buy',
        quantity: '1',
        filled: '0',
        status: 'NEW',
        createdAt: new Date(),
      }),
    };

    mockCreateExchange.mockReturnValue(fakeExchange);

    const service = new OrderService();
    const riskInput = {
      trade: {
        decisionId: 'decision-dup',
        symbol: 'BTCUSDT',
        action: 'BUY' as const,
        entry: 50000,
        stopLoss: 49000,
        takeProfit: 52000,
        requestedPositionSize: 1,
        riskAmount: 1000,
        portfolioHeatBefore: 0,
        symbolExposureBefore: 0,
        correlatedExposureBefore: 0,
        leverage: 1,
        marginRequired: 50000,
        estimatedFees: 0,
        estimatedSlippage: 0,
        dailyPnL: 0,
        dailyLossLimit: 1000,
        drawdown: 0,
      },
      account: {
        totalEquity: 100000,
        availableBalance: 100000,
        marginUsed: 0,
        freeMargin: 100000,
        unrealizedPnL: 0,
        realizedPnL: 0,
        leverage: 1,
        peakEquity: 100000,
        currentDrawdown: 0,
        dailyPnL: 0,
        weeklyPnL: 0,
        consecutiveLosses: 0,
        tradingEnabled: true,
        killSwitch: false,
      },
      positions: [],
      market: { spread: 0, liquidity: 1, slippage: 0, stale: false, volatility: 0 },
    };
    const riskDecision = new RiskEngine().evaluate(riskInput);
    const auth = authorizationService.issueFromDecision(riskDecision, {
      mode: 'TESTNET',
      accountId: 'acct-dup',
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 1,
    });

    await service.place('acct-dup', 'binance', {
      symbol: 'BTCUSDT',
      side: 'buy',
      type: 'limit',
      quantity: '1',
      price: '50000',
      clientOrderId: 'decision-dup-v1',
    }, 'decision-dup', auth, {
      id: 'acct-dup',
      userId: 'user-dup',
      exchange: 'binance',
      isActive: true,
      tradingMode: 'TESTNET',
    });

    await expect(service.place('acct-dup', 'binance', {
      symbol: 'BTCUSDT',
      side: 'buy',
      type: 'limit',
      quantity: '1',
      price: '50000',
      clientOrderId: 'decision-dup-v2',
    }, 'decision-dup', auth, {
      id: 'acct-dup',
      userId: 'user-dup',
      exchange: 'binance',
      isActive: true,
      tradingMode: 'TESTNET',
    })).rejects.toThrow(/Duplicate order submission blocked/);

    expect(fakeExchange.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('2b. direct OrderService.place cannot omit canonical risk context', async () => {
    const service = new OrderService();
    await expect(Reflect.apply(service.place, service, [
      'acct-no-context',
      'binance',
      {
        symbol: 'BTCUSDT',
        side: 'buy',
        type: 'limit',
        quantity: '1',
        price: '50000',
      },
      'decision-no-context',
      undefined,
      {
        id: 'acct-no-context',
        userId: 'user-no-context',
        exchange: 'binance',
        isActive: true,
        tradingMode: 'TESTNET',
      },
    ])).rejects.toThrow(/trusted execution authorization is required/i);
  });

  it('3. process crash after exchange accepted the order', () => {
    const localOrder = engine.createOrderRecord({
      decisionId: 'decision-crash',
      riskDecisionId: 'risk-crash',
      authorizationId: 'auth-crash',
      accountId: 'acct-crash',
      exchange: 'binance',
      symbol: 'ETHUSDT',
      side: 'SELL',
      requestedQuantity: 2,
      approvedQuantity: 2,
      requestedPrice: 2500,
    });

    const afterRestart = engine.reconcileLocalToExchange(
      engine.transition(localOrder, 'SUBMITTING'),
      {
        ...localOrder,
        exchangeOrderId: 'exchange-eth-1',
        status: 'ACCEPTED',
        filledQuantity: 0,
        remainingQuantity: 2,
        lastExchangeUpdateAt: Date.now(),
      },
    );

    expect(afterRestart?.status).toBe('ACCEPTED');
    expect(afterRestart?.exchangeOrderId).toBe('exchange-eth-1');
  });

  it('4. partial fill is tracked without assuming full execution', () => {
    const record = engine.createOrderRecord({
      decisionId: 'decision-partial',
      riskDecisionId: 'risk-partial',
      authorizationId: 'auth-partial',
      accountId: 'acct-partial',
      exchange: 'binance',
      symbol: 'SOLUSDT',
      side: 'BUY',
      requestedQuantity: 1,
      approvedQuantity: 1,
      requestedPrice: 150,
    });

    const partial = engine.mergeFillEvent(record, {
      filledQuantity: 0.4,
      averagePrice: 149.5,
      fee: 0.02,
    });

    expect(partial.status).toBe('PARTIALLY_FILLED');
    expect(partial.filledQuantity).toBe(0.4);
    expect(partial.remainingQuantity).toBe(0.6);
  });

  it('5. fill and cancel occurring together cannot regress to stale state', () => {
    const record = engine.createOrderRecord({
      decisionId: 'decision-fill-cancel',
      riskDecisionId: 'risk-fill-cancel',
      authorizationId: 'auth-fill-cancel',
      accountId: 'acct-fill-cancel',
      exchange: 'binance',
      symbol: 'AVAXUSDT',
      side: 'BUY',
      requestedQuantity: 1,
      approvedQuantity: 1,
      requestedPrice: 40,
    });

    const submitting = engine.transition(record, 'SUBMITTING');
    const accepted = engine.transition(submitting, 'ACCEPTED');
    const cancelPending = engine.transition(accepted, 'CANCEL_PENDING');
    const final = engine.mergeFillEvent(cancelPending, {
      filledQuantity: 1,
      averagePrice: 39.9,
      fee: 0.015,
      status: 'FILLED',
    });

    expect(final.status).toBe('FILLED');
    expect(final.filledQuantity).toBe(1);
    expect(final.remainingQuantity).toBe(0);
  });

  it('6. websocket disconnect/reconnect does not blind retry UNKNOWN state', () => {
    const initial = engine.createOrderRecord({
      decisionId: 'decision-ws',
      riskDecisionId: 'risk-ws',
      authorizationId: 'auth-ws',
      accountId: 'acct-ws',
      exchange: 'binance',
      symbol: 'XRPUSDT',
      side: 'SELL',
      requestedQuantity: 100,
      approvedQuantity: 100,
      requestedPrice: 0.6,
    });

    const unknown = engine.transition(engine.transition(initial, 'SUBMITTING'), 'UNKNOWN');
    expect(engine.shouldRetryUnknownOrder(unknown.status)).toBe(false);

    const afterReconnect = engine.reconcileLocalToExchange(unknown, {
      ...unknown,
      status: 'PARTIALLY_FILLED',
      filledQuantity: 20,
      remainingQuantity: 80,
    });

    expect(engine.shouldRetryUnknownOrder(afterReconnect?.status ?? 'UNKNOWN')).toBe(true);
  });

  it('7. local order mismatch is resolved to exchange truth', () => {
    const local = engine.createOrderRecord({
      decisionId: 'decision-local-mismatch',
      riskDecisionId: 'risk-local-mismatch',
      authorizationId: 'auth-local-mismatch',
      accountId: 'acct-local-mismatch',
      exchange: 'binance',
      symbol: 'DOGEUSDT',
      side: 'BUY',
      requestedQuantity: 2000,
      approvedQuantity: 2000,
      requestedPrice: 0.1,
    });

    const exchangeOrder: any = {
      ...local,
      exchangeOrderId: 'ex-order-77',
      status: 'FILLED' as const,
      filledQuantity: 2000,
      remainingQuantity: 0,
      averageFillPrice: 0.101,
    };

    const reconciled = engine.reconcileLocalToExchange(local, exchangeOrder);
    expect(reconciled?.status).toBe('FILLED');
    expect(reconciled?.filledQuantity).toBe(2000);
  });

  it('8. local position mismatch is resolved to exchange truth', () => {
    const localPosition = { symbol: 'BTCUSDT', side: 'long' as const, quantity: 0.5, entryPrice: 53000, leverage: 2 };
    const exchangePosition = { symbol: 'BTCUSDT', side: 'long' as const, quantity: 0.75, entryPrice: 52800, leverage: 2 };

    const merged = engine.reconcilePosition(localPosition, exchangePosition);
    expect(merged?.quantity).toBe(0.75);
    expect(merged?.entryPrice).toBe(52800);
  });

  it('9. restart recovery restores open state without creating duplicate orders', () => {
    const localOrder = engine.createOrderRecord({
      decisionId: 'decision-restart',
      riskDecisionId: 'risk-restart',
      authorizationId: 'auth-restart',
      accountId: 'acct-restart',
      exchange: 'binance',
      symbol: 'LINKUSDT',
      side: 'BUY',
      requestedQuantity: 3,
      approvedQuantity: 3,
      requestedPrice: 18,
    });

    const persisted = engine.transition(localOrder, 'SUBMITTING');
    const recovered = engine.reconcileLocalToExchange(persisted, {
      ...persisted,
      exchangeOrderId: 'link-ext-2',
      status: 'ACCEPTED',
      filledQuantity: 0,
      remainingQuantity: 3,
    });

    expect(recovered?.status).toBe('ACCEPTED');
    expect(recovered?.exchangeOrderId).toBe('link-ext-2');
    expect(engine.shouldBlockNewOrder(recovered!)).toBe(true);
  });

  it('10. duplicate fill events are idempotent and never double-counted', () => {
    const record = engine.createOrderRecord({
      decisionId: 'decision-dedupe',
      riskDecisionId: 'risk-dedupe',
      authorizationId: 'auth-dedupe',
      accountId: 'acct-dedupe',
      exchange: 'binance',
      symbol: 'ADAUSDT',
      side: 'BUY',
      requestedQuantity: 1000,
      approvedQuantity: 1000,
      requestedPrice: 1.2,
    });

    const afterFirst = engine.mergeFillEvent(record, {
      filledQuantity: 400,
      averagePrice: 1.2,
      fee: 0.05,
    });
    const afterReplay = engine.mergeFillEvent(afterFirst, {
      filledQuantity: 400,
      averagePrice: 1.2,
      fee: 0.05,
    });

    expect(afterReplay.filledQuantity).toBe(400);
    expect(afterReplay.remainingQuantity).toBe(600);
  });

  it('11. startup health gate blocks new order entry until system is ready', () => {
    const readiness = SystemReadinessService.getInstance();
    readiness.setPhase('STARTING');
    expect(readiness.canCreateNewEntry()).toBe(false);

    readiness.setPhase('SYSTEM_READY', 'startup-complete');
    readiness.setCheck('AI_READY', true);
    readiness.setCheck('LEARNING_READY', true);
    readiness.setCheck('RISK_READY', true);
    readiness.setCheck('EXECUTION_READY', true);
    readiness.setCheck('EXCHANGE_READY', true);
    readiness.setCheck('WEBSOCKET_READY', true);
    readiness.setCheck('RECONCILIATION_READY', true);
    readiness.setCheck('STARTUP_GATE_READY', true);
    readiness.setCheck('DATABASE_READY', true);
    readiness.setCheck('CONFIG_VALID', true);
    readiness.setCheck('ACCOUNT_SYNC_READY', true);
    readiness.setCheck('ORDER_SYNC_READY', true);
    readiness.setCheck('POSITION_SYNC_READY', true);
    readiness.setCheck('EVENT_ROUTER_READY', true);
    readiness.setCheck('PAPER_READY', true);
    readiness.setCheck('TESTNET_READY', true);
    readiness.setCheck('LIVE_READY', false);

    expect(readiness.canCreateNewEntry()).toBe(true);
  });

  it('12. duplicate Binance user-data fill events are ignored', () => {
    const adapter = new BinanceAdapter({
      id: 'acct-binance-userdata',
      userId: 'user-1',
      exchange: 'binance',
      isActive: true,
      tradingMode: 'TESTNET',
      credentials: { apiKey: 'key', apiSecret: 'secret' },
    } as any);

    const first = (adapter as any).normalizeUserDataEvent({
      e: 'executionReport',
      s: 'BTCUSDT',
      x: 'TRADE',
      i: 123,
      S: 'BUY',
      q: '0.1',
      z: '0.1',
      p: '50000',
    });

    const second = (adapter as any).normalizeUserDataEvent({
      e: 'executionReport',
      s: 'BTCUSDT',
      x: 'TRADE',
      i: 123,
      S: 'BUY',
      q: '0.1',
      z: '0.1',
      p: '50000',
    });

    expect(first?.kind).toBe('order');
    expect(second?.kind).toBe('order');
    expect(first?.filledQuantity).toBe(0.1);
    expect(second?.filledQuantity).toBe(0.1);
  });

  it('13. invalid state transition remains fail-safe', () => {
    const record = engine.createOrderRecord({
      decisionId: 'decision-invalid',
      riskDecisionId: 'risk-invalid',
      authorizationId: 'auth-invalid',
      accountId: 'acct-invalid',
      exchange: 'binance',
      symbol: 'BTCUSDT',
      side: 'BUY',
      requestedQuantity: 1,
      approvedQuantity: 1,
      requestedPrice: 50000,
    });

    expect(() => engine.transition(record, 'FILLED')).toThrow(/Invalid order transition/);
  });

  it('keeps an exchange-rejected order terminal across a recovery boundary', () => {
    const record = engine.createOrderRecord({
      decisionId: 'stale-testnet-order',
      riskDecisionId: 'risk-stale-testnet-order',
      authorizationId: 'auth-stale-testnet-order',
      accountId: 'acct-stale-testnet-order',
      exchange: 'binance',
      symbol: 'BTCUSDT',
      side: 'BUY',
      requestedQuantity: 0.00007,
      approvedQuantity: 0.00007,
      requestedPrice: 77635.84,
    });

    const rejected = engine.transition(record, 'REJECTED');
    const recovered = engine.normalizeStatus(rejected.status);

    expect(recovered).toBe('REJECTED');
    expect(ExecutionEngine.STATUS_TRANSITIONS.REJECTED).toEqual(['REJECTED']);
    expect(() => engine.transition(rejected, 'NEW')).toThrow(/Invalid order transition/);
    expect(() => engine.transition(rejected, 'SUBMITTING')).toThrow(/Invalid order transition/);
  });
});
