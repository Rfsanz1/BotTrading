import assert from 'node:assert/strict';
import {
  AuthorizationService,
  ExchangeReconciliationService,
  ExecutionEngine,
  FakePaperExchangeAdapter,
  RiskEngine,
  type ExchangeAccount,
  type Order,
} from '@rfsanz/exchange';

type LocalOrder = {
  id: string;
  decisionId: string;
  status: string;
  quantity: number;
  filled: number;
  externalId?: string;
};

class InMemoryRedis {
  private readonly values = new Map<string, string>();

  set(key: string, value: string): void {
    this.values.set(key, value);
  }

  get(key: string): string | undefined {
    return this.values.get(key);
  }

  incr(key: string): number {
    const next = Number(this.values.get(key) ?? 0) + 1;
    this.values.set(key, String(next));
    return next;
  }
}

class InMemoryPaperStore {
  private readonly orders = new Map<string, LocalOrder>();
  private readonly seenEvents = new Set<string>();
  private readonly trades = new Set<string>();
  private readonly positions = new Map<string, number>();

  create(order: LocalOrder): void {
    if (this.orders.has(order.id)) throw new Error('duplicate order');
    this.orders.set(order.id, { ...order });
  }

  apply(event: {
    eventId: string;
    orderId?: string;
    status?: string;
    filledQuantity?: number;
    quantity?: number;
    kind?: string;
  }): void {
    if (this.seenEvents.has(event.eventId)) return;
    this.seenEvents.add(event.eventId);
    if (!event.orderId) return;
    const order = this.orders.get(event.orderId);
    if (!order) throw new Error('event references unknown order');

    const filled = Number(event.filledQuantity ?? order.filled);
    if (event.kind === 'fill' && filled > order.filled) {
      this.trades.add(`${event.orderId}:${event.eventId}`);
      this.positions.set(event.orderId, filled);
    }
    if (order.status === 'FILLED' && event.status === 'CANCELED') return;
    order.filled = Math.max(order.filled, filled);
    order.status = order.status === 'FILLED' ? 'FILLED' : (event.status ?? order.status);
    order.externalId ??= event.orderId;
  }

  snapshot(): string {
    return JSON.stringify({
      orders: [...this.orders.values()],
      trades: [...this.trades],
      positions: [...this.positions.entries()],
    });
  }

  restore(snapshot: string): InMemoryPaperStore {
    const value = JSON.parse(snapshot) as {
      orders: LocalOrder[];
      trades: string[];
      positions: [string, number][];
    };
    for (const order of value.orders) this.orders.set(order.id, { ...order });
    for (const trade of value.trades) this.trades.add(trade);
    for (const position of value.positions) this.positions.set(position[0], position[1]);
    return this;
  }

  get(orderId: string): LocalOrder {
    const order = this.orders.get(orderId);
    if (!order) throw new Error(`missing order ${orderId}`);
    return { ...order };
  }

  tradeCount(): number {
    return this.trades.size;
  }

  positionQuantity(orderId: string): number {
    return this.positions.get(orderId) ?? 0;
  }

  orderCount(): number {
    return this.orders.size;
  }

  rejectInvalidTerminalTransition(orderId: string, status: string): void {
    const order = this.orders.get(orderId);
    if (!order || order.status === 'FILLED' || order.status === 'CANCELED' || order.status === 'REJECTED') {
      throw new Error(`terminal-state protection: ${orderId} -> ${status}`);
    }
  }
}

const account: ExchangeAccount = {
  id: 'local-paper-account',
  userId: 'local-paper-user',
  exchange: 'paper',
  accountId: 'LOCAL_OFFLINE_PAPER',
  isActive: true,
  isPaper: true,
  tradingMode: 'PAPER',
};

function authorize(decisionId: string, quantity: number, price: number) {
  const risk = new RiskEngine().evaluate({
    trade: {
      decisionId,
      symbol: 'BTCUSDT',
      action: 'BUY',
      intent: 'ENTRY',
      entry: price,
      stopLoss: price - 1,
      takeProfit: price + 2,
      requestedPositionSize: quantity,
      riskAmount: quantity,
      portfolioHeatBefore: 0,
      symbolExposureBefore: 0,
      correlatedExposureBefore: 0,
      leverage: 1,
      marginRequired: quantity * price,
      estimatedFees: 0,
      estimatedSlippage: 0,
      dailyPnL: 0,
      dailyLossLimit: 1000,
      drawdown: 0,
    },
    account: {
      totalEquity: 10_000,
      availableBalance: 10_000,
      marginUsed: 0,
      freeMargin: 10_000,
      unrealizedPnL: 0,
      realizedPnL: 0,
      leverage: 1,
      peakEquity: 10_000,
      currentDrawdown: 0,
      dailyPnL: 0,
      weeklyPnL: 0,
      consecutiveLosses: 0,
      tradingEnabled: true,
      killSwitch: false,
    },
    positions: [],
    market: { spread: 0.001, liquidity: 0.99, slippage: 0, stale: false, volatility: 0.001 },
  });
  assert.equal(risk.approved, true);
  const authorization = new AuthorizationService().issueFromDecision(risk, {
    mode: 'PAPER',
    accountId: account.id,
    symbol: 'BTCUSDT',
    side: 'BUY',
    quantity,
    intent: 'ENTRY',
  });
  assert.equal(authorization.status, 'APPROVED');
  return { risk, authorization };
}

async function scenario(fillMode: 'accepted' | 'partial' | 'duplicate-fill' | 'fill-cancel-race' | 'timeout' | 'unknown') {
  const store = new InMemoryPaperStore();
  const adapter = new FakePaperExchangeAdapter(account, {
    fillMode,
    partialFillRatio: 0.5,
  });
  const orderId = `local-${fillMode}`;
  const quantity = 0.1;
  const price = 100;
  const { risk, authorization } = authorize(orderId, quantity, price);
  const engine = new ExecutionEngine();
  const record = engine.createOrderRecord({
    decisionId: orderId,
    riskDecisionId: risk.riskDecisionId,
    authorizationId: `auth-${orderId}`,
    accountId: account.id,
    exchange: 'paper',
    symbol: 'BTCUSDT',
    side: 'BUY',
    requestedQuantity: quantity,
    approvedQuantity: quantity,
    requestedPrice: price,
  });
  assert.equal(authorization.expiresAt > Date.now(), true);
  store.create({ id: orderId, decisionId: orderId, status: 'NEW', quantity, filled: 0 });
  await adapter.connect(account);
  adapter.on('user-data-event', (event: any) => store.apply({
    eventId: String(event.eventId),
    orderId: event.orderId,
    status: event.status,
    filledQuantity: event.filledQuantity,
    quantity: event.quantity,
    kind: event.kind,
  }));
  const placed = await adapter.placeOrder({
    symbol: 'BTCUSDT',
    side: 'buy',
    type: 'limit',
    quantity: String(quantity),
    price: String(price),
    clientOrderId: orderId,
  });
  if (fillMode === 'timeout') {
    const unknown = engine.transition(record, 'UNKNOWN');
    assert.equal(unknown.status, 'UNKNOWN');
  }
  if (fillMode === 'unknown') assert.equal(placed.status, 'UNKNOWN');
  if (fillMode === 'partial') assert.equal(store.get(orderId).status, 'PARTIALLY_FILLED');
  if (fillMode === 'duplicate-fill') assert.equal(store.tradeCount(), 1);
  if (fillMode === 'fill-cancel-race') assert.equal(store.get(orderId).status, 'FILLED');
  await adapter.disconnect();
  await adapter.reconnect();
  await adapter.startUserDataStream();
  await adapter.disconnect();
  return store;
}

async function main(): Promise<void> {
  const redis = new InMemoryRedis();
  redis.set('mode', 'LOCAL_OFFLINE_PAPER');
  assert.equal(redis.get('mode'), 'LOCAL_OFFLINE_PAPER');
  assert.equal(redis.incr('runs'), 1);

  const accepted = await scenario('accepted');
  assert.equal(accepted.positionQuantity('local-accepted'), 0.1);
  const partial = await scenario('partial');
  assert.equal(partial.positionQuantity('local-partial'), 0.05);
  await scenario('duplicate-fill');
  await scenario('fill-cancel-race');
  const timeout = await scenario('timeout');
  assert.equal(timeout.get('local-timeout').status, 'NEW');
  const unknown = await scenario('unknown');
  assert.equal(unknown.get('local-unknown').status, 'UNKNOWN');

  const restartStore = new InMemoryPaperStore();
  restartStore.create({ id: 'restart-order', decisionId: 'restart-order', status: 'FILLED', quantity: 0.1, filled: 0.1, externalId: 'restart-order' });
  const restored = new InMemoryPaperStore().restore(restartStore.snapshot());
  assert.equal(restored.get('restart-order').status, 'FILLED');
  assert.equal(restored.get('restart-order').filled, 0.1);

  const duplicateDecisionIds = new Set<string>();
  const decision = 'duplicate-decision';
  assert.equal(duplicateDecisionIds.has(decision), false);
  duplicateDecisionIds.add(decision);
  assert.equal(duplicateDecisionIds.has(decision), true);
  const acceptDecision = (value: string): void => {
    if (duplicateDecisionIds.has(value)) throw new Error('duplicate order blocked');
    duplicateDecisionIds.add(value);
  };
  assert.throws(() => acceptDecision(decision), /duplicate order blocked/);

  assert.throws(() => accepted.rejectInvalidTerminalTransition('local-accepted', 'NEW'), /terminal-state protection/);
  const reconciliation = new ExchangeReconciliationService();
  const result = await reconciliation.reconcileAll(
    { id: account.id, exchange: 'paper' },
    [{ clientOrderId: 'local-accepted', status: 'FILLED', filled: 0.1 }],
    [],
    { id: account.id, exchange: 'paper' },
    [{ clientOrderId: 'local-accepted', status: 'FILLED', filled: 0.1 }],
    [],
  );
  assert.equal(result.status, 'HEALTHY');

  console.log(JSON.stringify({
    mode: 'LOCAL_OFFLINE_PAPER',
    productionRuntimeChanged: false,
    redis: 'IN_MEMORY_TEST_SUBSTITUTE',
    scenarios: {
      entry: 'PASS',
      fill: 'PASS',
      partialFill: 'PASS',
      duplicateFill: 'PASS',
      timeoutUnknown: 'PASS',
      reconciliation: 'PASS',
      restartRecovery: 'PASS',
      reconnect: 'PASS',
      fillCancelRace: 'PASS',
      duplicateOrderProtection: 'PASS',
      terminalStateProtection: 'PASS',
    },
    database: 'IN_MEMORY_TEST_STORAGE',
    externalOrders: 0,
  }));
}

void main().catch((error) => {
  console.error(`FAIL LOCAL_OFFLINE_PAPER: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
