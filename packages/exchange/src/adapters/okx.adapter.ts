import ExchangeBase from '../ExchangeBase';
import { ExchangeAccount, Balance, MarketTicker, OrderParams, Order, Position } from '../types';

const unsupported = (): never => { throw new Error('NotImplemented: OKX adapter is disabled'); };
export class OkxAdapter extends ExchangeBase {
  name = 'okx';
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
export default OkxAdapter;
