import { IExchange } from '../IExchange';
import {
  ProtectionOrder,
  ProtectionOrderParams,
  ProtectionState,
} from '../types';

export type ProtectionRecord = ProtectionOrder & {
  state: ProtectionState;
  error?: string;
};

export class ProtectionOrderService {
  private readonly records = new Map<string, ProtectionRecord>();
  private readonly inFlight = new Set<string>();

  async create(exchange: IExchange, params: ProtectionOrderParams): Promise<ProtectionRecord> {
    const existing = this.records.get(params.clientOrderId);
    if (existing && !['FAILED', 'CANCELED'].includes(existing.state)) {
      throw new Error(`Duplicate protection request blocked for ${params.clientOrderId}`);
    }
    if (!exchange.createProtectionOrder) {
      throw new Error('Exchange does not support native protection orders');
    }
    if (this.inFlight.has(params.clientOrderId)) {
      throw new Error(`Protection request is already in flight for ${params.clientOrderId}`);
    }
    this.inFlight.add(params.clientOrderId);
    this.records.set(params.clientOrderId, {
      id: params.clientOrderId,
      clientOrderId: params.clientOrderId,
      symbol: params.symbol,
      side: params.side,
      quantity: params.quantity,
      triggerPrice: params.triggerPrice,
      limitPrice: params.limitPrice,
      kind: params.kind,
      status: 'PENDING',
      state: 'PENDING',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    try {
      const order = await exchange.createProtectionOrder(params);
      if (!order.externalId && !order.id) throw new Error('Protection acknowledgement has no exchange identity');
      const confirmed: ProtectionRecord = { ...order, state: 'CONFIRMED', updatedAt: new Date() };
      this.records.set(params.clientOrderId, confirmed);
      return confirmed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      let reconciled: ProtectionOrder | null = null;
      if (exchange.getProtectionOrder) {
        try {
          reconciled = await exchange.getProtectionOrder(params.clientOrderId, params.symbol);
        } catch {
          // Preserve UNKNOWN below; reconciliation failures are not success.
        }
      }
      if (reconciled?.externalId || reconciled?.id) {
        const confirmed: ProtectionRecord = { ...reconciled, state: 'CONFIRMED', updatedAt: new Date() };
        this.records.set(params.clientOrderId, confirmed);
        return confirmed;
      }
      const state: ProtectionState = message.toLowerCase().includes('timeout') ? 'UNKNOWN' : 'FAILED';
      const failed = { ...this.records.get(params.clientOrderId)!, state, error: message, updatedAt: new Date() };
      this.records.set(params.clientOrderId, failed);
      throw new Error(`Protection order ${state.toLowerCase()}: ${message}`);
    } finally {
      this.inFlight.delete(params.clientOrderId);
    }
  }

  async cancel(exchange: IExchange, clientOrderId: string, symbol?: string): Promise<ProtectionRecord> {
    const current = this.records.get(clientOrderId);
    if (!current) throw new Error(`Protection order ${clientOrderId} is not known`);
    if (!exchange.cancelProtectionOrder) throw new Error('Exchange does not support native protection cancellation');
    await exchange.cancelProtectionOrder(current.externalId ?? clientOrderId, symbol ?? current.symbol);
    const canceled = { ...current, state: 'CANCELED' as const, status: 'CANCELED', updatedAt: new Date() };
    this.records.set(clientOrderId, canceled);
    return canceled;
  }

  async amend(exchange: IExchange, clientOrderId: string, params: Partial<ProtectionOrderParams>): Promise<ProtectionRecord> {
    const current = this.records.get(clientOrderId);
    if (!current) throw new Error(`Protection order ${clientOrderId} is not known`);
    if (!exchange.cancelProtectionOrder || !exchange.createProtectionOrder) {
      throw new Error('Exchange does not support cancel-and-recreate protection amendment');
    }
    await this.cancel(exchange, clientOrderId, params.symbol ?? current.symbol);
    try {
      return await this.create(exchange, {
        symbol: params.symbol ?? current.symbol,
        side: params.side ?? current.side,
        quantity: params.quantity ?? current.quantity,
        triggerPrice: params.triggerPrice ?? current.triggerPrice,
        limitPrice: params.limitPrice ?? current.limitPrice,
        clientOrderId: params.clientOrderId ?? clientOrderId,
        kind: params.kind ?? current.kind,
        timeInForce: params.timeInForce,
      });
    } catch (error) {
      throw new Error(`Protection amendment failed after cancellation; position is unprotected: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  get(clientOrderId: string): ProtectionRecord | undefined {
    return this.records.get(clientOrderId);
  }

  async reconcile(exchange: IExchange, clientOrderId: string, symbol?: string): Promise<ProtectionRecord> {
    const current = this.records.get(clientOrderId);
    if (!current) throw new Error(`Protection order ${clientOrderId} is not known`);
    if (!exchange.getProtectionOrder) throw new Error('Exchange does not support native protection reconciliation');
    const order = await exchange.getProtectionOrder(current.externalId ?? clientOrderId, symbol ?? current.symbol);
    if (!order) {
      const unknown = { ...current, state: 'UNKNOWN' as const, updatedAt: new Date() };
      this.records.set(clientOrderId, unknown);
      return unknown;
    }
    const confirmed = { ...order, state: 'CONFIRMED' as const, updatedAt: new Date() };
    this.records.set(clientOrderId, confirmed);
    return confirmed;
  }
}

export default ProtectionOrderService;
