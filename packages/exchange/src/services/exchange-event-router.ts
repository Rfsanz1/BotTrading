import { ExecutionEngine, OrderRecord } from './execution-engine';
import { SystemReadinessService } from './system-readiness.service';

export type ExchangeEventKind = 'ORDER' | 'FILL' | 'ACCOUNT' | 'POSITION';

export interface ExchangeEventEnvelope {
  kind: ExchangeEventKind;
  source: string;
  eventId: string;
  symbol?: string;
  orderId?: string;
  clientOrderId?: string;
  status?: string;
  side?: string;
  quantity?: number;
  filledQuantity?: number;
  price?: number;
  averagePrice?: number;
  fee?: number;
  exchangeTradeId?: string;
  fillQuantity?: number;
  asset?: string;
  balance?: string;
  entryPrice?: number;
  account?: Record<string, any>;
  raw?: Record<string, any>;
  timestamp?: number;
}

export class ExchangeEventRouter {
  private readonly executionEngine = new ExecutionEngine();
  private readonly seenEventIds = new Set<string>();
  private readonly orders = new Map<string, OrderRecord>();
  private readonly accounts = new Map<string, Record<string, any>>();
  private readonly positions = new Map<string, Record<string, any>>();
  private readonly readiness = SystemReadinessService.getInstance();
  constructor(private readonly onEvent?: (event: ExchangeEventEnvelope) => void | Promise<void>) {}

  handle(rawEvent: any): ExchangeEventEnvelope | null {
    const event = this.normalize(rawEvent);
    if (!event) return null;

    const dedupeKey = this.buildDedupeKey(event);
    if (this.seenEventIds.has(dedupeKey)) {
      return null;
    }
    this.seenEventIds.add(dedupeKey);

    switch (event.kind) {
      case 'ORDER':
        this.processOrder(event);
        this.readiness.setCheck('WEBSOCKET_READY', true, 'user-data stream event received');
        break;
      case 'FILL':
        this.processFill(event);
        this.readiness.setCheck('WEBSOCKET_READY', true, 'fill event received');
        break;
      case 'ACCOUNT':
        this.processAccount(event);
        this.readiness.setCheck('EXCHANGE_READY', true, 'account update received');
        break;
      case 'POSITION':
        this.processPosition(event);
        break;
      default:
        return null;
    }

    if (this.onEvent) {
      void Promise.resolve(this.onEvent(event)).catch(() => {
        console.error(`Exchange event persistence failed for ${event.eventId}`);
      });
    }
    return event;
  }

  normalize(rawEvent: any): ExchangeEventEnvelope | null {
    if (!rawEvent || typeof rawEvent !== 'object') return null;

    const kindRaw = String(rawEvent.kind ?? rawEvent.type ?? rawEvent.eventType ?? '').toUpperCase();
    let kind: ExchangeEventKind | null = null;

    if (kindRaw === 'FILL' || rawEvent.kind === 'fill' || (rawEvent.e === 'executionReport' && (rawEvent.x === 'TRADE' || rawEvent.t !== undefined || rawEvent.l !== undefined))) {
      kind = 'FILL';
    } else if (kindRaw === 'ORDER' || rawEvent.kind === 'order' || rawEvent.e === 'executionReport') {
      kind = 'ORDER';
    } else if (kindRaw === 'ACCOUNT' || rawEvent.kind === 'account' || ['outboundAccountInfo', 'balanceUpdate'].includes(rawEvent.e)) {
      kind = 'ACCOUNT';
    } else if (kindRaw === 'POSITION' || rawEvent.kind === 'position' || rawEvent.e === 'outboundAccountPosition') {
      kind = 'POSITION';
    }

    if (!kind) return null;

    const eventId = String(
      rawEvent.eventId ?? rawEvent.id ?? rawEvent.orderId ?? rawEvent.clientOrderId ?? rawEvent.symbol ?? `${kind}:${Date.now()}`,
    );

    return {
      kind,
      source: String(rawEvent.source ?? 'binance'),
      eventId,
      symbol: rawEvent.symbol,
      orderId: rawEvent.orderId ?? rawEvent.exchangeOrderId ?? rawEvent.i,
      clientOrderId: rawEvent.clientOrderId ?? rawEvent.clientOrderId ?? rawEvent.c,
      status: rawEvent.status ?? rawEvent.x,
      side: rawEvent.side ?? rawEvent.S,
      quantity: this.toNumber(rawEvent.quantity ?? rawEvent.q ?? rawEvent.origQty),
      filledQuantity: this.toNumber(rawEvent.filledQuantity ?? rawEvent.z ?? rawEvent.executedQty),
      price: this.toNumber(rawEvent.price ?? rawEvent.p ?? rawEvent.lastPrice),
      averagePrice: this.toNumber(rawEvent.averagePrice ?? rawEvent.ap ?? rawEvent.avgPrice),
      fee: this.toNumber(rawEvent.fee ?? rawEvent.feeCoin ?? rawEvent.commission),
      exchangeTradeId: rawEvent.exchangeTradeId ?? rawEvent.tradeId ?? rawEvent.t ?? rawEvent.id,
      fillQuantity: this.toNumber(rawEvent.fillQuantity ?? rawEvent.lastFilledQuantity ?? rawEvent.l),
      asset: rawEvent.asset ?? rawEvent.a,
      balance: rawEvent.balance ?? rawEvent.b,
      entryPrice: this.toNumber(rawEvent.entryPrice ?? rawEvent.entry),
      account: rawEvent.account,
      raw: rawEvent,
      timestamp: Number(rawEvent.timestamp ?? rawEvent.E ?? Date.now()),
    };
  }

  private buildDedupeKey(event: ExchangeEventEnvelope): string {
    return [event.kind, event.source, event.exchangeTradeId ?? event.eventId, event.orderId ?? '', event.symbol ?? ''].join(':');
  }

  private toNumber(value: any): number | undefined {
    if (value === undefined || value === null || value === '') return undefined;
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : undefined;
  }

  private getOrderRecordKey(event: ExchangeEventEnvelope): string {
    return `${event.source}:${event.orderId ?? event.clientOrderId ?? event.symbol ?? 'unknown-order'}`;
  }

  private processOrder(event: ExchangeEventEnvelope): void {
    const key = this.getOrderRecordKey(event);
    const existing = this.orders.get(key) ?? this.createBaseOrderRecord(event);
    const normalizedStatus = this.executionEngine.normalizeStatus(
      event.status === 'FILLED' && !event.exchangeTradeId
        ? existing.status ?? 'NEW'
        : event.status ?? existing.status ?? 'NEW',
    );
    const updated = this.executionEngine.reconcileLocalToExchange(existing, {
      ...existing,
      clientOrderId: event.clientOrderId ?? existing.clientOrderId,
      exchangeOrderId: event.orderId ?? existing.exchangeOrderId,
      symbol: event.symbol ?? existing.symbol,
      side: (event.side ?? existing.side ?? 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
      status: normalizedStatus,
      requestedQuantity: event.quantity ?? existing.requestedQuantity,
      approvedQuantity: event.quantity ?? existing.approvedQuantity,
      filledQuantity: event.filledQuantity ?? existing.filledQuantity,
      remainingQuantity: Math.max((event.quantity ?? existing.approvedQuantity ?? existing.requestedQuantity) - (event.filledQuantity ?? existing.filledQuantity), 0),
      requestedPrice: event.price ?? existing.requestedPrice,
      averageFillPrice: event.averagePrice ?? existing.averageFillPrice,
      fee: event.fee ?? existing.fee,
      lastExchangeUpdateAt: Date.now(),
    });
    this.orders.set(key, updated ?? existing);
  }

  private processFill(event: ExchangeEventEnvelope): void {
    const orderKey = this.getOrderRecordKey(event);
    const existing = this.orders.get(orderKey) ?? this.createBaseOrderRecord(event);
    const updated = this.executionEngine.mergeFillEvent(existing, {
      filledQuantity: this.toNumber(event.filledQuantity ?? event.quantity ?? existing.filledQuantity ?? 0) ?? 0,
      averagePrice: event.averagePrice ?? event.price ?? existing.averageFillPrice,
      fee: event.fee ?? existing.fee,
      status: this.executionEngine.normalizeStatus(event.status ?? (event.filledQuantity !== undefined ? 'FILLED' : existing.status)),
    });
    this.orders.set(orderKey, updated);
  }

  private processAccount(event: ExchangeEventEnvelope): void {
    const assetKey = String(event.asset ?? 'account');
    this.accounts.set(assetKey, {
      asset: event.asset,
      balance: event.balance,
      source: event.source,
      timestamp: Date.now(),
      raw: event.raw,
    });
  }

  private processPosition(event: ExchangeEventEnvelope): void {
    const symbolKey = String(event.symbol ?? 'UNKNOWN');
    const position = {
      symbol: event.symbol ?? symbolKey,
      side: event.side ?? 'LONG',
      quantity: Number(event.quantity ?? 0),
      entryPrice: Number(event.entryPrice ?? event.price ?? 0),
      source: event.source,
      timestamp: Date.now(),
      raw: event.raw,
    };
    this.positions.set(symbolKey, position);
  }

  private createBaseOrderRecord(event: ExchangeEventEnvelope): OrderRecord {
    return this.executionEngine.createOrderRecord({
      decisionId: `router-${event.eventId}`,
      riskDecisionId: `risk-${event.eventId}`,
      authorizationId: `auth-${event.eventId}`,
      accountId: 'router-account',
      exchange: event.source,
      symbol: event.symbol ?? 'UNKNOWN',
      side: (event.side ?? 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY',
      requestedQuantity: event.quantity ?? 0,
      approvedQuantity: event.quantity ?? 0,
      requestedPrice: event.price ?? event.averagePrice ?? 0,
      type: 'LIMIT',
    });
  }

  getOrderState(key: string): OrderRecord | undefined {
    return this.orders.get(key);
  }

  getAccountState(asset?: string): Record<string, any> | undefined {
    return asset ? this.accounts.get(asset) : this.accounts.values().next().value;
  }

  getPositionState(symbol?: string): Record<string, any> | undefined {
    return symbol ? this.positions.get(symbol) : this.positions.values().next().value;
  }
}

export default ExchangeEventRouter;
