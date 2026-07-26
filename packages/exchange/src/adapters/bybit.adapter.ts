import ExchangeBase from '../ExchangeBase';
import { ExchangeAccount, Balance, MarketTicker, OrderParams, Order, Position } from '../types';

export class BybitAdapter extends ExchangeBase {
  name = 'bybit';
  constructor(account?: ExchangeAccount) { super(account); }
  async fetchBalances(): Promise<Balance[]> { return []; }
  async fetchTicker(symbol: string): Promise<MarketTicker> { return { symbol, bid: '0', ask: '0', last: '0', timestamp: Date.now() }; }
  async placeOrder(params: OrderParams): Promise<Order> { return { id: `ord-${Date.now()}`, symbol: params.symbol, side: params.side, quantity: params.quantity, filled: '0', createdAt: new Date(), status: 'NEW' } as Order; }
  async cancelOrder(orderId: string): Promise<void> { return; }
  async getOrder(orderId: string): Promise<Order | null> { return null; }
  async fetchOpenPositions(): Promise<Position[]> { return []; }
  subscribeTicker(symbol: string): void { this.emit('ticker', { symbol }); }
  unsubscribeTicker(symbol: string): void { }
}

export default BybitAdapter;
