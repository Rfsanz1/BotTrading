import { EventEmitter } from 'eventemitter3';
import { ExchangeAccount, Balance, OrderParams, Order, Position, MarketTicker, MarketType } from './types';

export interface IExchange extends EventEmitter {
  name: string;
  connect(account: ExchangeAccount): Promise<void>;
  disconnect(): Promise<void>;
  fetchBalances(): Promise<Balance[]>;
  fetchTicker(symbol: string): Promise<MarketTicker>;
  placeOrder(params: OrderParams): Promise<Order>;
  cancelOrder(orderId: string): Promise<void>;
  getOrder(orderId: string): Promise<Order | null>;
  fetchOpenPositions(): Promise<Position[]>;
  subscribeTicker(symbol: string): void;
  unsubscribeTicker(symbol: string): void;
}

export default IExchange;
