import { ExchangeAccount, Order } from '../types';

export type ExecutionConfirmationSource = 'EXCHANGE_QUERY' | 'USER_DATA_EVENT' | 'RECONCILIATION';
export type ExecutionConfirmationStatus = 'FILLED' | 'PARTIALLY_FILLED';

export interface TrustedExecutionConfirmation {
  readonly status: ExecutionConfirmationStatus;
  readonly decisionId: string;
  readonly orderId: string;
  readonly externalOrderId: string;
  readonly accountId: string;
  readonly exchange: string;
  readonly symbol: string;
  readonly side: 'BUY' | 'SELL';
  readonly cumulativeExecutedQuantity: number;
  readonly averageExecutionPrice: number;
  readonly fees: number;
  readonly exchangeTradeId?: string;
  readonly executionId: string;
  readonly verifiedAt: number;
  readonly source: ExecutionConfirmationSource;
}

const trustedConfirmations = new WeakSet<object>();

export function isTrustedExecutionConfirmation(value: unknown): value is TrustedExecutionConfirmation {
  return typeof value === 'object' && value !== null && trustedConfirmations.has(value);
}

export class ExecutionConfirmationService {
  fromExchangeOrder(
    local: {
      orderId: string;
      decisionId: string;
      externalOrderId: string;
      account: ExchangeAccount;
      symbol: string;
      side: 'BUY' | 'SELL';
      quantity: number;
    },
    exchangeOrder: Order,
    source: ExecutionConfirmationSource = 'EXCHANGE_QUERY',
  ): TrustedExecutionConfirmation {
    if (!['EXCHANGE_QUERY', 'USER_DATA_EVENT', 'RECONCILIATION'].includes(source)) {
      throw new Error('Execution confirmation source is not trusted');
    }
    const externalOrderId = String(exchangeOrder.externalId || exchangeOrder.id);
    const status = String(exchangeOrder.status).toUpperCase();
    const cumulativeExecutedQuantity = Number(exchangeOrder.filled);
    const averageExecutionPrice = Number(exchangeOrder.meta?.averagePrice ?? exchangeOrder.price);
    const exchangeTradeId = exchangeOrder.meta?.exchangeTradeId
      ? String(exchangeOrder.meta.exchangeTradeId)
      : undefined;

    if (!local.orderId || !local.decisionId || !local.externalOrderId) throw new Error('Execution identity is incomplete');
    if (externalOrderId !== local.externalOrderId) throw new Error('Exchange order identity mismatch');
    if (exchangeOrder.symbol !== local.symbol) throw new Error('Exchange symbol mismatch');
    if (exchangeOrder.side.toUpperCase() !== local.side) throw new Error('Exchange side mismatch');
    if (exchangeOrder.id !== local.externalOrderId && exchangeOrder.clientOrderId !== local.externalOrderId) {
      throw new Error('Exchange order identity is not authoritative');
    }
    if (!['FILLED', 'PARTIALLY_FILLED'].includes(status)) {
      throw new Error(`Exchange execution status is not executable: ${status}`);
    }
    if (!Number.isFinite(cumulativeExecutedQuantity) || cumulativeExecutedQuantity <= 0) {
      throw new Error('Exchange executed quantity is invalid');
    }
    if (cumulativeExecutedQuantity > local.quantity + 1e-9) {
      throw new Error('Exchange executed quantity exceeds local order quantity');
    }
    if (!Number.isFinite(averageExecutionPrice) || averageExecutionPrice <= 0) {
      throw new Error('Exchange execution price is invalid');
    }

    const confirmation: TrustedExecutionConfirmation = Object.freeze({
      status: status as ExecutionConfirmationStatus,
      decisionId: local.decisionId,
      orderId: local.orderId,
      externalOrderId,
      accountId: local.account.id,
      exchange: local.account.exchange,
      symbol: local.symbol,
      side: local.side,
      cumulativeExecutedQuantity,
      averageExecutionPrice,
      fees: Number(exchangeOrder.meta?.fee ?? 0),
      exchangeTradeId,
      executionId: exchangeTradeId
        ? `${externalOrderId}:${exchangeTradeId}`
        : `${externalOrderId}:${status}:${cumulativeExecutedQuantity}`,
      verifiedAt: Date.now(),
      source,
    });
    trustedConfirmations.add(confirmation);
    return confirmation;
  }

  verify(
    confirmation: unknown,
    expected: {
      orderId: string;
      decisionId: string;
      externalOrderId: string;
      accountId: string;
      exchange: string;
      symbol: string;
      side: 'BUY' | 'SELL';
      quantity: number;
    },
  ): confirmation is TrustedExecutionConfirmation {
    if (!isTrustedExecutionConfirmation(confirmation)) return false;
    if (!['FILLED', 'PARTIALLY_FILLED'].includes(confirmation.status)) return false;
    if (confirmation.orderId !== expected.orderId || confirmation.decisionId !== expected.decisionId) return false;
    if (confirmation.externalOrderId !== expected.externalOrderId) return false;
    if (confirmation.accountId !== expected.accountId || confirmation.exchange !== expected.exchange) return false;
    if (confirmation.symbol !== expected.symbol || confirmation.side !== expected.side) return false;
    if (confirmation.cumulativeExecutedQuantity <= 0 || confirmation.cumulativeExecutedQuantity > expected.quantity + 1e-9) return false;
    if (!Number.isFinite(confirmation.verifiedAt) || confirmation.verifiedAt > Date.now() || Date.now() - confirmation.verifiedAt > 5 * 60 * 1000) return false;
    return Number.isFinite(confirmation.averageExecutionPrice) && confirmation.averageExecutionPrice > 0;
  }
}

export const executionConfirmationService = new ExecutionConfirmationService();
