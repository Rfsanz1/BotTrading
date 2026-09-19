import ExchangeBase from '../ExchangeBase';
import { Order, Position, Balance } from '../IExchange';

/**
 * Binance adapter (stub)
 * Implement exchange-specific REST/WebSocket logic here.
 */
export class BinanceAdapter extends ExchangeBase {
  async connect(config: Record<string, any>) {
    this._config = config;
    // TODO: initialize REST client / websockets
    this._connected = true;
  }
  async disconnect() {
    // TODO: cleanup
    this._connected = false;
  }
  async getBalances(): Promise<Balance[]> {
    // TODO: call Binance API
    return [];
  }
  async getPositions(): Promise<Position[]> {
    return [];
  }
  async placeOrder(order: Partial<Order>): Promise<Order> {
    throw new Error('BinanceAdapter.placeOrder not implemented');
  }
  async cancelOrder(orderId: string): Promise<void> {
    throw new Error('BinanceAdapter.cancelOrder not implemented');
  }
  async fetchOrder(orderId: string): Promise<Order | null> {
    return null;
  }
}

export default BinanceAdapter;
