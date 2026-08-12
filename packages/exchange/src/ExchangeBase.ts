import EventEmitter from 'eventemitter3';
import { IExchange } from './IExchange';
import { ExchangeAccount, Balance, OrderParams, Order, Position, MarketTicker } from './types';

export abstract class ExchangeBase extends EventEmitter implements IExchange {
  abstract name: string;
  protected account?: ExchangeAccount;
  protected connected = false;
  protected paper = false;

  constructor(account?: ExchangeAccount) {
    super();
    if (account) this.account = account;
    this.paper = !!account?.isPaper;
  }

  async connect(account: ExchangeAccount): Promise<void> {
    this.account = account;
    this.paper = !!account.isPaper;
    this.connected = true;
    this.emit('connected', { accountId: account.id });
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.emit('disconnected');
  }

  abstract fetchBalances(): Promise<Balance[]>;
  abstract fetchTicker(symbol: string): Promise<MarketTicker>;
  abstract placeOrder(params: OrderParams): Promise<Order>;
  abstract cancelOrder(orderId: string): Promise<void>;
  abstract getOrder(orderId: string): Promise<Order | null>;
  abstract fetchOpenOrders(symbol?: string): Promise<Order[]>;
  abstract fetchOpenPositions(): Promise<Position[]>;
  abstract subscribeTicker(symbol: string): void;
  abstract unsubscribeTicker(symbol: string): void;
}

export default ExchangeBase;
