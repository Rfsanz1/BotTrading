import ExchangeBase from '../ExchangeBase';
import { Order, Position, Balance } from '../IExchange';

/**
 * MetaTrader 5 adapter stub — typically requires a bridge connector or broker API.
 */
export class MT5Adapter extends ExchangeBase {
  async connect(config: Record<string, any>) { this._config = config; this._connected = true; }
  async disconnect() { this._connected = false; }
  async getBalances(): Promise<Balance[]> { return []; }
  async getPositions(): Promise<Position[]> { return []; }
  async placeOrder(order: Partial<Order>): Promise<Order> { throw new Error('Not implemented'); }
  async cancelOrder(orderId: string): Promise<void> { throw new Error('Not implemented'); }
  async fetchOrder(orderId: string): Promise<Order | null> { return null; }
}

export default MT5Adapter;
