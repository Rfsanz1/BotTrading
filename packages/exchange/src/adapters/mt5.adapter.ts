import ExchangeBase from '../ExchangeBase';
import { ExchangeAccount, Balance, MarketTicker, OrderParams, Order, Position } from '../types';

const unsupported = (): never => { throw new Error('NotImplemented: MT5 adapter is disabled'); };
export class MT5Adapter extends ExchangeBase {
  name = 'mt5';
  constructor(account?: ExchangeAccount) { super(account); }
  async fetchBalances(): Promise<Balance[]> { return unsupported(); }
  async fetchTicker(_symbol: string): Promise<MarketTicker> { return unsupported(); }
  async placeOrder(_params: OrderParams): Promise<Order> { return unsupported(); }
  async cancelOrder(_orderId: string): Promise<void> { return unsupported(); }
  async getOrder(_orderId: string, _symbol?: string): Promise<Order | null> { return unsupported(); }
  async fetchOpenOrders(_symbol?: string): Promise<Order[]> { return unsupported(); }
  async fetchOpenPositions(): Promise<Position[]> { return unsupported(); }
  subscribeTicker(_symbol: string): void { unsupported(); }
  unsubscribeTicker(_symbol: string): void { unsupported(); }
}
export default MT5Adapter;
