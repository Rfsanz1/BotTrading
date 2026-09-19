export type CanonicalOrderStatus =
  | 'NEW'
  | 'SUBMITTING'
  | 'ACCEPTED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCEL_PENDING'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'UNKNOWN';

export interface OrderRecord {
  clientOrderId: string;
  exchangeOrderId?: string;
  decisionId: string;
  riskDecisionId: string;
  authorizationId: string;
  accountId: string;
  exchange: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  type: 'LIMIT' | 'MARKET';
  requestedQuantity: number;
  approvedQuantity: number;
  filledQuantity: number;
  remainingQuantity: number;
  requestedPrice?: number;
  averageFillPrice?: number;
  status: CanonicalOrderStatus;
  executionStatus: string;
  timeInForce: 'GTC' | 'IOC' | 'FOK';
  reduceOnly?: boolean;
  positionSide?: 'LONG' | 'SHORT';
  leverage?: number;
  fee?: number;
  slippage?: number;
  createdAt: number;
  submittedAt?: number;
  updatedAt: number;
  filledAt?: number;
  cancelledAt?: number;
  lastExchangeUpdateAt?: number;
  orderVersion: number;
}

export interface ExecutionAuthorizationLike {
  status: 'APPROVED';
  decisionId: string;
  riskDecisionId: string;
  riskVersion: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  entry: number;
  mode: 'PAPER' | 'TESTNET' | 'LIVE';
  accountId: string;
  issuedAt: number;
  expiresAt: number;
}

export type OrderEventType =
  | 'ORDER_CREATED'
  | 'ORDER_SUBMITTING'
  | 'ORDER_ACCEPTED'
  | 'ORDER_PARTIALLY_FILLED'
  | 'ORDER_FILLED'
  | 'ORDER_REJECTED'
  | 'ORDER_CANCEL_PENDING'
  | 'ORDER_CANCELLED'
  | 'ORDER_EXPIRED'
  | 'ORDER_UNKNOWN';

export function buildCanonicalClientOrderId(decisionId: string, suffix?: string): string {
  const identity = `${decisionId}${suffix ? `:${suffix}` : ''}`;
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 32);
  return `bt-${digest}`;
}

export class ExecutionEngine {
  static readonly STATUS_TRANSITIONS: Record<CanonicalOrderStatus, CanonicalOrderStatus[]> = {
    NEW: ['SUBMITTING', 'REJECTED', 'UNKNOWN'],
    SUBMITTING: ['ACCEPTED', 'PARTIALLY_FILLED', 'REJECTED', 'UNKNOWN'],
    ACCEPTED: ['PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING', 'CANCELLED', 'UNKNOWN'],
    PARTIALLY_FILLED: ['PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING', 'CANCELLED', 'UNKNOWN'],
    FILLED: ['FILLED'],
    CANCEL_PENDING: ['CANCELLED', 'UNKNOWN'],
    CANCELLED: ['CANCELLED'],
    REJECTED: ['REJECTED'],
    EXPIRED: ['EXPIRED'],
    UNKNOWN: ['SUBMITTING', 'ACCEPTED', 'PARTIALLY_FILLED', 'FILLED', 'CANCEL_PENDING', 'CANCELLED', 'REJECTED', 'EXPIRED', 'UNKNOWN'],
  };

  private static readonly DETECTED_NULL = /^(?:null|undefined)$/i;

  createOrderRecord(input: {
    decisionId: string;
    riskDecisionId: string;
    authorizationId: string;
    accountId: string;
    exchange: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    type?: 'LIMIT' | 'MARKET';
    requestedQuantity: number;
    approvedQuantity?: number;
    requestedPrice?: number;
    timeInForce?: 'GTC' | 'IOC' | 'FOK';
    leverage?: number;
    reduceOnly?: boolean;
    positionSide?: 'LONG' | 'SHORT';
    orderVersion?: number;
  }): OrderRecord {
    const approvedQuantity = Number.isFinite(input.approvedQuantity ?? input.requestedQuantity)
      ? Number(input.approvedQuantity ?? input.requestedQuantity)
      : 0;

    return {
      clientOrderId: buildCanonicalClientOrderId(input.decisionId, `v${input.orderVersion ?? 1}`),
      decisionId: input.decisionId,
      riskDecisionId: input.riskDecisionId,
      authorizationId: input.authorizationId,
      accountId: input.accountId,
      exchange: input.exchange,
      symbol: input.symbol,
      side: input.side,
      type: input.type ?? 'LIMIT',
      requestedQuantity: Number(input.requestedQuantity),
      approvedQuantity,
      filledQuantity: 0,
      remainingQuantity: approvedQuantity,
      requestedPrice: input.requestedPrice,
      status: 'NEW',
      executionStatus: 'NEW',
      timeInForce: input.timeInForce ?? 'GTC',
      reduceOnly: input.reduceOnly,
      positionSide: input.positionSide,
      leverage: input.leverage,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      orderVersion: input.orderVersion ?? 1,
    };
  }

  transition(record: OrderRecord, nextStatus: CanonicalOrderStatus, patch: Partial<OrderRecord> = {}): OrderRecord {
    const current = record.status;
    if (!ExecutionEngine.STATUS_TRANSITIONS[current]?.includes(nextStatus)) {
      throw new Error(`Invalid order transition: ${current} -> ${nextStatus}`);
    }

    return {
      ...record,
      ...patch,
      status: nextStatus,
      executionStatus: nextStatus,
      updatedAt: Date.now(),
      submittedAt: nextStatus === 'SUBMITTING' ? Date.now() : record.submittedAt,
      filledAt: nextStatus === 'FILLED' ? Date.now() : record.filledAt,
      cancelledAt: nextStatus === 'CANCELLED' ? Date.now() : record.cancelledAt,
      lastExchangeUpdateAt: patch.lastExchangeUpdateAt ?? record.lastExchangeUpdateAt,
    };
  }

  verifyAuthorization(auth: ExecutionAuthorizationLike, expected: {
    decisionId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    entry: number;
    riskDecisionId: string;
    riskVersion?: string;
    mode?: 'PAPER' | 'TESTNET' | 'LIVE';
    accountId?: string;
    intent?: import('./risk-engine').RiskTradeIntent;
    positionId?: string;
  }): boolean {
    if (!isTrustedExecutionAuthorization(auth)) return false;
    if (auth.decisionId !== expected.decisionId) return false;
    if (auth.riskDecisionId !== expected.riskDecisionId) return false;
    if (expected.mode && auth.mode !== expected.mode) return false;
    if (expected.accountId && auth.accountId !== expected.accountId) return false;
    if (auth.intent !== expected.intent || auth.positionId !== expected.positionId) return false;
    if (auth.symbol !== expected.symbol) return false;
    if (auth.side !== expected.side) return false;
    if (Math.abs(auth.quantity - expected.quantity) > 1e-9) return false;
    if (Math.abs(auth.entry - expected.entry) > 1e-9) return false;
    if (Date.now() >= auth.expiresAt) return false;
    return true;
  }

  normalizeStatus(raw: string | undefined | null): CanonicalOrderStatus {
    const s = String(raw ?? '').toUpperCase();
    if (!s || ExecutionEngine.DETECTED_NULL.test(s)) return 'UNKNOWN';

    const map: Record<string, CanonicalOrderStatus> = {
      NEW: 'NEW',
      SUBMITTING: 'SUBMITTING',
      ACCEPTED: 'ACCEPTED',
      PARTIALLY_FILLED: 'PARTIALLY_FILLED',
      PARTIALLYFILLED: 'PARTIALLY_FILLED',
      FILLED: 'FILLED',
      CANCEL_PENDING: 'CANCEL_PENDING',
      CANCELLED: 'CANCELLED',
      CANCELED: 'CANCELLED',
      REJECTED: 'REJECTED',
      EXPIRED: 'EXPIRED',
      UNKNOWN: 'UNKNOWN',
    };

    return map[s] ?? 'UNKNOWN';
  }

  buildClientOrderId(decisionId: string, suffix?: string): string {
    return buildCanonicalClientOrderId(decisionId, suffix);
  }

  dedupeKey(record: Pick<OrderRecord, 'decisionId' | 'clientOrderId' | 'symbol'>): string {
    return `${record.decisionId}:${record.clientOrderId}:${record.symbol}`;
  }

  shouldBlockNewOrder(order: Pick<OrderRecord, 'status' | 'decisionId'>): boolean {
    return ['NEW', 'SUBMITTING', 'ACCEPTED', 'PARTIALLY_FILLED'].includes(order.status);
  }

  hasActiveDecision(orders: Pick<OrderRecord, 'decisionId' | 'status'>[], decisionId: string): boolean {
    return orders.some((order) => order.decisionId === decisionId && ['NEW', 'SUBMITTING', 'ACCEPTED', 'PARTIALLY_FILLED', 'UNKNOWN'].includes(order.status));
  }

  mapExchangeOrderToRecord(exchangeOrder: {
    clientOrderId?: string;
    orderId?: string | number;
    symbol?: string;
    side?: string;
    price?: string | number;
    quantity?: string | number;
    filled?: string | number;
    status?: string;
    createdAt?: number | Date;
    updatedAt?: number | Date;
    decisionId?: string;
    riskDecisionId?: string;
    authorizationId?: string;
    accountId?: string;
    exchange?: string;
  }, orderBase: Partial<OrderRecord>): OrderRecord {
    const normalizedStatus = this.normalizeStatus(exchangeOrder.status);
    const requestedQuantity = Number(orderBase.requestedQuantity ?? exchangeOrder.quantity ?? 0);
    const approvedQuantity = Number(orderBase.approvedQuantity ?? requestedQuantity);
    const filledQuantity = Number(exchangeOrder.filled ?? 0);

    return {
      clientOrderId: exchangeOrder.clientOrderId ?? orderBase.clientOrderId ?? 'unknown',
      exchangeOrderId: String(exchangeOrder.orderId ?? orderBase.exchangeOrderId ?? 'unknown'),
      decisionId: orderBase.decisionId ?? exchangeOrder.decisionId ?? 'unknown-decision',
      riskDecisionId: orderBase.riskDecisionId ?? exchangeOrder.riskDecisionId ?? 'unknown-risk',
      authorizationId: orderBase.authorizationId ?? exchangeOrder.authorizationId ?? 'unknown-auth',
      accountId: orderBase.accountId ?? exchangeOrder.accountId ?? 'unknown-account',
      exchange: orderBase.exchange ?? exchangeOrder.exchange ?? 'unknown-exchange',
      symbol: orderBase.symbol ?? exchangeOrder.symbol ?? 'UNKNOWN',
      side: (orderBase.side ?? String(exchangeOrder.side ?? 'BUY')).toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
      type: orderBase.type ?? 'LIMIT',
      requestedQuantity,
      approvedQuantity,
      filledQuantity,
      remainingQuantity: Math.max(approvedQuantity - filledQuantity, 0),
      requestedPrice: orderBase.requestedPrice ?? Number(exchangeOrder.price ?? 0),
      averageFillPrice: orderBase.averageFillPrice ?? Number(exchangeOrder.price ?? 0),
      status: normalizedStatus,
      executionStatus: normalizedStatus,
      timeInForce: orderBase.timeInForce ?? 'GTC',
      reduceOnly: orderBase.reduceOnly,
      positionSide: orderBase.positionSide,
      leverage: orderBase.leverage,
      fee: orderBase.fee,
      slippage: orderBase.slippage,
      createdAt: orderBase.createdAt ?? (exchangeOrder.createdAt ? new Date(exchangeOrder.createdAt).getTime() : Date.now()),
      submittedAt: orderBase.submittedAt,
      updatedAt: orderBase.updatedAt ?? Date.now(),
      filledAt: orderBase.filledAt,
      cancelledAt: orderBase.cancelledAt,
      lastExchangeUpdateAt: orderBase.lastExchangeUpdateAt ?? Date.now(),
      orderVersion: orderBase.orderVersion ?? 1,
    };
  }

  reconcileLocalToExchange(
    localOrder: OrderRecord | null,
    exchangeOrder: (Partial<OrderRecord> & { status?: CanonicalOrderStatus | string }) | null,
  ): OrderRecord | null {
    if (!localOrder && !exchangeOrder) return null;
    if (!localOrder) {
      return this.mapExchangeOrderToRecord({
        clientOrderId: exchangeOrder?.clientOrderId,
        orderId: exchangeOrder?.exchangeOrderId,
        symbol: exchangeOrder?.symbol,
        side: exchangeOrder?.side,
        price: exchangeOrder?.requestedPrice,
        quantity: exchangeOrder?.approvedQuantity ?? exchangeOrder?.requestedQuantity,
        filled: exchangeOrder?.filledQuantity,
        status: exchangeOrder?.status,
        createdAt: exchangeOrder?.createdAt,
        updatedAt: exchangeOrder?.updatedAt,
        decisionId: exchangeOrder?.decisionId,
        riskDecisionId: exchangeOrder?.riskDecisionId,
        authorizationId: exchangeOrder?.authorizationId,
        accountId: exchangeOrder?.accountId,
        exchange: exchangeOrder?.exchange,
      }, exchangeOrder ?? {});
    }

    if (!exchangeOrder) return localOrder;

    const final = { ...localOrder, ...exchangeOrder } as OrderRecord;
    const exchangeFilled = Number(exchangeOrder.filledQuantity ?? 0);
    const localFilled = Number(localOrder.filledQuantity ?? 0);
    const mergedFilled = Math.max(exchangeFilled, localFilled);
    const approvedMax = Math.max(
      Number(localOrder.approvedQuantity ?? localOrder.requestedQuantity ?? 0),
      Number(exchangeOrder.approvedQuantity ?? exchangeOrder.requestedQuantity ?? 0),
    );

    final.filledQuantity = mergedFilled;
    final.remainingQuantity = Math.max(approvedMax - mergedFilled, 0);
    final.status = this.normalizeStatus((exchangeOrder.status ?? localOrder.status) as string | undefined);
    final.executionStatus = final.status;
    final.averageFillPrice = exchangeOrder.averageFillPrice ?? localOrder.averageFillPrice ?? exchangeOrder.requestedPrice ?? localOrder.requestedPrice;
    final.lastExchangeUpdateAt = exchangeOrder.lastExchangeUpdateAt ?? localOrder.lastExchangeUpdateAt ?? Date.now();
    if (mergedFilled > 0 && final.status === 'NEW') final.status = 'PARTIALLY_FILLED';
    return final;
  }

  mergeFillEvent(localOrder: OrderRecord, fillEvent: { filledQuantity: number; averagePrice?: number; fee?: number; status?: CanonicalOrderStatus; }): OrderRecord {
    const nextFilled = Math.max(Number(localOrder.filledQuantity ?? 0), Number(fillEvent.filledQuantity ?? 0));
    const nextApproved = Math.max(Number(localOrder.approvedQuantity ?? localOrder.requestedQuantity ?? 0), Number(localOrder.requestedQuantity ?? 0));
    const status = fillEvent.status ?? (nextFilled >= nextApproved ? 'FILLED' : 'PARTIALLY_FILLED');

    const merged: OrderRecord = {
      ...localOrder,
      filledQuantity: nextFilled,
      remainingQuantity: Math.max(nextApproved - nextFilled, 0),
      averageFillPrice: fillEvent.averagePrice ?? localOrder.averageFillPrice ?? localOrder.requestedPrice,
      fee: fillEvent.fee ?? localOrder.fee,
      status,
      executionStatus: status,
      updatedAt: Date.now(),
      lastExchangeUpdateAt: Date.now(),
    };

    if (merged.remainingQuantity <= 0 && merged.status !== 'CANCELLED') {
      merged.status = 'FILLED';
      merged.executionStatus = 'FILLED';
      merged.filledAt = merged.filledAt ?? Date.now();
    }

    return merged;
  }

  reconcilePosition(
    localPosition: { symbol: string; side: 'long' | 'short'; quantity: number; entryPrice: number; leverage?: number } | null,
    exchangePosition: { symbol: string; side: 'long' | 'short'; quantity: number; entryPrice: number; leverage?: number } | null,
  ): { symbol: string; side: 'long' | 'short'; quantity: number; entryPrice: number; leverage?: number } | null {
    if (!localPosition && !exchangePosition) return null;
    if (!localPosition) return exchangePosition;
    if (!exchangePosition) return localPosition;

    return {
      ...localPosition,
      ...exchangePosition,
      quantity: Number(exchangePosition.quantity ?? localPosition.quantity),
      entryPrice: Number(exchangePosition.entryPrice ?? localPosition.entryPrice),
      leverage: Number(exchangePosition.leverage ?? localPosition.leverage ?? 1),
      side: exchangePosition.side ?? localPosition.side,
      symbol: exchangePosition.symbol ?? localPosition.symbol,
    };
  }

  shouldRetryUnknownOrder(status: CanonicalOrderStatus): boolean {
    return status !== 'UNKNOWN';
  }

  isRecoveryRequired(record: Pick<OrderRecord, 'status'>): boolean {
    return record.status === 'UNKNOWN' || record.status === 'REJECTED';
  }

  applyOrderEvent(record: OrderRecord, event: { status?: CanonicalOrderStatus; filledQuantity?: number; averagePrice?: number; fee?: number; }): OrderRecord {
    if (event.status) {
      return this.transition(record, event.status, {
        filledQuantity: event.filledQuantity ?? record.filledQuantity,
        averageFillPrice: event.averagePrice ?? record.averageFillPrice,
        fee: event.fee ?? record.fee,
      });
    }
    if (typeof event.filledQuantity === 'number') {
      return this.mergeFillEvent(record, {
        filledQuantity: event.filledQuantity,
        averagePrice: event.averagePrice,
        fee: event.fee,
      });
    }
    return record;
  }
}

export default new ExecutionEngine();
import { isTrustedExecutionAuthorization } from './authorization.service';
import { createHash } from 'node:crypto';
