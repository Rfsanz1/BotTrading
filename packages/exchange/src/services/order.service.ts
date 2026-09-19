import { createExchange } from '../factory';
import { ExchangeName } from '../factory';
import { ExchangeAccount, OrderParams, Order } from '../types';
import { ExecutionEngine } from './execution-engine';
import { assertExecutionAllowed } from './execution-mode.service';
import { authorizationService, TrustedExecutionAuthorization } from './authorization.service';

export class OrderService {
  private readonly executionEngine = new ExecutionEngine();
  private readonly inFlightOrders = new Map<string, string>();
  private readonly inFlightDecisions = new Map<string, string>();
  private readonly seenDecisions = new Set<string>();

  async place(
    accountId: string,
    exchange: ExchangeName,
    params: OrderParams,
    decisionId: string,
    auth: TrustedExecutionAuthorization,
    account: ExchangeAccount,
  ): Promise<Order> {
    if (!params.symbol || !params.quantity || Number(params.quantity) <= 0) {
      throw new Error('Invalid order quantity');
    }

    assertExecutionAllowed(exchange, account);
    if (!auth) throw new Error('Trusted execution authorization is required');

    const runtimeDecisionId = decisionId;
    const clientOrderId = params.clientOrderId ?? this.executionEngine.buildClientOrderId(runtimeDecisionId);

    if (this.seenDecisions.has(runtimeDecisionId) || this.inFlightDecisions.has(runtimeDecisionId) || this.inFlightOrders.has(clientOrderId)) {
      throw new Error(`Duplicate order submission blocked for decisionId=${runtimeDecisionId} clientOrderId=${clientOrderId}`);
    }

    if (!authorizationService.verify(auth, {
      decisionId: runtimeDecisionId,
      riskDecisionId: auth.riskDecisionId,
      riskVersion: auth.riskVersion,
      symbol: params.symbol,
      side: params.side === 'buy' ? 'BUY' : 'SELL',
      quantity: Number(params.quantity),
      entry: params.price === undefined ? auth.entry : Number(params.price),
      intent: params.intent,
      positionId: params.positionId,
      mode: account.tradingMode ?? 'PAPER',
      accountId: account.id,
    }) || !this.executionEngine.verifyAuthorization(auth, {
      decisionId: runtimeDecisionId,
      symbol: params.symbol,
      side: params.side === 'buy' ? 'BUY' : 'SELL',
      quantity: Number(params.quantity),
      entry: params.price === undefined ? auth.entry : Number(params.price),
      intent: params.intent,
      positionId: params.positionId,
      riskDecisionId: auth.riskDecisionId,
      riskVersion: auth.riskVersion,
      mode: account.tradingMode,
      accountId: account.id,
    })) {
      throw new Error('Authorization mismatch or expired');
    }

    this.inFlightOrders.set(clientOrderId, runtimeDecisionId);
    this.inFlightDecisions.set(runtimeDecisionId, clientOrderId);
    this.seenDecisions.add(runtimeDecisionId);
    const record = this.executionEngine.createOrderRecord({
      decisionId: runtimeDecisionId,
      riskDecisionId: auth.riskDecisionId,
      authorizationId: `auth-${runtimeDecisionId}`,
      accountId: accountId,
      exchange,
      symbol: params.symbol,
      side: params.side === 'buy' ? 'BUY' : 'SELL',
      requestedQuantity: Number(params.quantity),
      approvedQuantity: Number(params.quantity),
      requestedPrice: Number(params.price ?? 0),
      timeInForce: params.timeInForce ?? 'GTC',
    });

    const submittingRecord = this.executionEngine.transition(record, 'SUBMITTING');
    const ex = createExchange(exchange, account);
    await ex.connect(account);
    try {
      const order = await ex.placeOrder({ ...params, clientOrderId });
      authorizationService.consume(auth, clientOrderId);
      const reconciled = this.executionEngine.mapExchangeOrderToRecord(order, submittingRecord);
      if (this.executionEngine.shouldBlockNewOrder(reconciled)) {
        return order;
      }
      return order;
    } finally {
      this.inFlightOrders.delete(clientOrderId);
      this.inFlightDecisions.delete(runtimeDecisionId);
      await ex.disconnect();
    }
  }

  async cancel(accountId: string, exchange: ExchangeName, orderId: string, account: ExchangeAccount): Promise<void> {
    assertExecutionAllowed(exchange, account);
    const ex = createExchange(exchange, account);
    await ex.connect(account);
    await ex.cancelOrder(orderId);
    await ex.disconnect();
  }
}

export default new OrderService();
