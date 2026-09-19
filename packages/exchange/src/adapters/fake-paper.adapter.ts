import ExchangeBase from '../ExchangeBase';
import { ExchangeEventRouter } from '../services/exchange-event-router';
import { ExchangeAccount, Balance, MarketTicker, OrderParams, Order, Position } from '../types';

export type PaperFillMode =
  | 'accepted'
  | 'partial'
  | 'duplicate-fill'
  | 'fill-cancel-race'
  | 'reject'
  | 'cancelled'
  | 'timeout'
  | 'unknown';

export interface FakePaperAdapterOptions {
  fillMode?: PaperFillMode;
  partialFillRatio?: number;
  balance?: { asset: string; free: string; locked: string }[];
  position?: Position[];
}

export class FakePaperExchangeAdapter extends ExchangeBase {
  name = 'paper';
  private readonly fillMode: PaperFillMode;
  private readonly partialFillRatio: number;
  private readonly balances: Balance[];
  private readonly positions: Position[];
  private static readonly sharedOrders = new Map<string, Map<string, Order>>();

  private getAccountScopedOrders(): Map<string, Order> {
    const accountId = this.account?.id ?? '__default__';
    if (!FakePaperExchangeAdapter.sharedOrders.has(accountId)) {
      FakePaperExchangeAdapter.sharedOrders.set(accountId, new Map());
    }
    return FakePaperExchangeAdapter.sharedOrders.get(accountId)!;
  }

  constructor(account?: ExchangeAccount, options: FakePaperAdapterOptions = {}) {
    super(account);
    this.fillMode = options.fillMode ?? 'accepted';
    this.partialFillRatio = options.partialFillRatio ?? 0.5;
    this.balances = (options.balance ?? [{ asset: 'USDT', free: '10000', locked: '0' }]).map((b) => ({
      asset: b.asset,
      free: b.free,
      locked: b.locked,
    }));
    this.positions = (options.position ?? []).map((p) => ({ ...p }));
  }

  async connect(account: ExchangeAccount): Promise<void> {
    await super.connect(account);
    this.emit('connected', { accountId: account.id, mode: 'paper' });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected');
    this.emit('websocket.disconnected', { type: 'paper-user-data', reason: 'test disconnect' });
  }

  resetForTest(): void {
    this.clearAccountState();
  }

  private clearAccountState(): void {
    const accountId = this.account?.id ?? '__default__';
    const accountOrders = FakePaperExchangeAdapter.sharedOrders.get(accountId);
    if (accountOrders) {
      accountOrders.clear();
    }
    this.positions.length = 0;
  }

  async reconnect(): Promise<void> {
    if (!this.account) throw new Error('Paper exchange cannot reconnect without an account');
    await this.connect(this.account);
    await this.startUserDataStream();
  }

  async startUserDataStream(): Promise<void> {
    if (!this.connected) {
      throw new Error('Paper exchange must be connected before starting user-data stream');
    }
    this.emit('websocket.connected', { type: 'paper-user-data' });
  }

  async fetchBalances(): Promise<Balance[]> {
    return [...this.balances];
  }

  async fetchTicker(symbol: string): Promise<MarketTicker> {
    return {
      symbol,
      bid: '100',
      ask: '101',
      last: '100.5',
      timestamp: Date.now(),
    };
  }

  bindRouter(router: ExchangeEventRouter): () => void {
    const listener = (event: any) => {
      router.handle({ ...event, source: 'paper' });
    };
    this.on('user-data-event', listener);
    return () => this.off('user-data-event', listener);
  }

  async placeOrder(params: OrderParams): Promise<Order> {
    const id = params.clientOrderId ?? `paper-${Date.now()}`;
    const base: Order = {
      id,
      clientOrderId: id,
      externalId: id,
      symbol: params.symbol,
      side: params.side,
      price: params.price ?? '100',
      quantity: params.quantity,
      filled: '0',
      status: 'NEW',
      createdAt: new Date(),
      updatedAt: new Date(),
      meta: { mode: 'paper', fillMode: this.fillMode },
    };
    const accountOrders = this.getAccountScopedOrders();

    if (this.fillMode === 'reject') {
      base.status = 'REJECTED';
      accountOrders.set(id, base);
      this.emit('user-data-event', { kind: 'order', source: 'paper', eventId: `${id}:reject`, orderId: id, clientOrderId: id, symbol: params.symbol, side: params.side, status: 'REJECTED', quantity: Number(params.quantity), filledQuantity: 0, price: Number(params.price ?? 0), type: 'user-data-event' });
      return base;
    }

    if (this.fillMode === 'timeout') {
      base.status = 'NEW';
      accountOrders.set(id, base);
      this.emit('user-data-event', { kind: 'order', source: 'paper', eventId: `${id}:timeout`, orderId: id, clientOrderId: id, symbol: params.symbol, side: params.side, status: 'NEW', quantity: Number(params.quantity), filledQuantity: 0, price: Number(params.price ?? 0), type: 'user-data-event' });
      return base;
    }

    if (this.fillMode === 'unknown') {
      base.status = 'UNKNOWN';
      accountOrders.set(id, base);
      this.emit('user-data-event', { kind: 'order', source: 'paper', eventId: `${id}:unknown`, orderId: id, clientOrderId: id, symbol: params.symbol, side: params.side, status: 'UNKNOWN', quantity: Number(params.quantity), filledQuantity: 0, price: Number(params.price ?? 0), type: 'user-data-event' });
      return base;
    }

    if (this.fillMode === 'cancelled') {
      base.status = 'CANCELED';
      accountOrders.set(id, base);
      this.emit('user-data-event', { kind: 'order', source: 'paper', eventId: `${id}:cancelled`, orderId: id, clientOrderId: id, symbol: params.symbol, side: params.side, status: 'CANCELED', quantity: Number(params.quantity), filledQuantity: 0, price: Number(params.price ?? 0), type: 'user-data-event' });
      return base;
    }

    if (this.fillMode === 'partial') {
      const total = Number(params.quantity);
      const filledQty = total * this.partialFillRatio;
      base.status = 'PARTIALLY_FILLED';
      base.filled = filledQty.toString();
      accountOrders.set(id, base);
      this.syncPositionFromOrder(base);
      this.emit('user-data-event', { kind: 'fill', source: 'paper', eventId: `${id}:partial-fill`, orderId: id, clientOrderId: id, symbol: params.symbol, side: params.side, status: 'PARTIALLY_FILLED', quantity: total, filledQuantity: filledQty, price: Number(params.price ?? 0), averagePrice: Number(params.price ?? 0), fee: 0.01, type: 'user-data-event' });
      return base;
    }

    base.status = 'FILLED';
    base.filled = params.quantity;
    accountOrders.set(id, base);
    this.syncPositionFromOrder(base);
    const fillEvent = { kind: 'fill', source: 'paper', eventId: `${id}:fill`, orderId: id, clientOrderId: id, symbol: params.symbol, side: params.side, status: 'FILLED', quantity: Number(params.quantity), filledQuantity: Number(params.quantity), price: Number(params.price ?? 0), averagePrice: Number(params.price ?? 0), fee: 0.01, type: 'user-data-event' };
    this.emit('user-data-event', fillEvent);
    if (this.fillMode === 'duplicate-fill') {
      this.emit('user-data-event', { ...fillEvent });
    }
    if (this.fillMode === 'fill-cancel-race') {
      this.emit('user-data-event', {
        kind: 'order',
        source: 'paper',
        eventId: `${id}:cancel-race`,
        orderId: id,
        clientOrderId: id,
        symbol: params.symbol,
        side: params.side,
        status: 'CANCELED',
        quantity: Number(params.quantity),
        filledQuantity: Number(params.quantity),
        price: Number(params.price ?? 0),
        type: 'user-data-event',
      });
    }
    return base;
  }

  async cancelOrder(orderId: string): Promise<void> {
    const accountOrders = this.getAccountScopedOrders();
    for (const [key, order] of accountOrders.entries()) {
      if (order.id === orderId || order.clientOrderId === orderId) {
        order.status = 'CANCELED';
        order.updatedAt = new Date();
        accountOrders.set(key, order);
      }
    }
  }

  async getOrder(orderId: string, _symbol?: string): Promise<Order | null> {
    const accountOrders = this.getAccountScopedOrders();
    return [...accountOrders.values()].find((order) => order.id === orderId || order.clientOrderId === orderId) ?? null;
  }

  async fetchOpenOrders(symbol?: string): Promise<Order[]> {
    return [...this.getAccountScopedOrders().values()].filter((order) => {
      if (symbol && order.symbol !== symbol) return false;
      return order.status === 'NEW' || order.status === 'PARTIALLY_FILLED' || order.status === 'UNKNOWN';
    });
  }

  private syncPositionFromOrder(order: Order): void {
    const filled = Number(order.filled ?? 0);
    if (!Number.isFinite(filled) || filled <= 0) return;

    const side: Position['side'] = order.side === 'buy' ? 'long' : 'short';
    const index = this.positions.findIndex((position) => position.symbol === order.symbol && position.status === 'OPEN');
    if (index === -1) {
      this.positions.push({
        id: `paper-pos-${order.id}`,
        symbol: order.symbol,
        side,
        entryPrice: order.price ?? '0',
        quantity: String(filled),
        status: 'OPEN',
        openedAt: new Date(),
      });
      return;
    }

    const current = this.positions[index];
    const currentQty = Number(current.quantity);
    const nextQty = current.side === side ? currentQty + filled : currentQty - filled;

    if (nextQty <= 0) {
      this.positions[index] = {
        ...current,
        quantity: '0',
        status: 'CLOSED',
        closedAt: new Date(),
      };
      return;
    }

    this.positions[index] = {
      ...current,
      quantity: String(nextQty),
      side,
      status: 'OPEN',
      entryPrice: current.side === side ? current.entryPrice : order.price ?? current.entryPrice,
      openedAt: current.openedAt,
    };
  }

  async fetchOpenPositions(): Promise<Position[]> {
    return this.positions.filter((position) => position.status === 'OPEN');
  }

  subscribeTicker(symbol: string): void {
    this.emit('ticker', { symbol });
  }

  unsubscribeTicker(symbol: string): void {
    this.emit('ticker:unsubscribe', { symbol });
  }
}

export default FakePaperExchangeAdapter;
