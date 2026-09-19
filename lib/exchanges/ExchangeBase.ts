import IExchange from './IExchange';

/**
 * Abstract base implementing small helpers and enforcing the interface.
 * Concrete adapters should extend this class and implement protocol-specific logic.
 */
export abstract class ExchangeBase implements IExchange {
  protected _connected = false;
  protected _config: Record<string, any> = {};

  abstract connect(config: Record<string, any>): Promise<void>;
  abstract disconnect(): Promise<void>;
  isConnected(): boolean {
    return this._connected;
  }

  // Account / Orders - child classes may override these with optimized APIs
  async getBalances() {
    throw new Error('getBalances not implemented');
  }
  async getPositions() {
    throw new Error('getPositions not implemented');
  }
  async placeOrder(order: any) {
    throw new Error('placeOrder not implemented');
  }
  async cancelOrder(orderId: string) {
    throw new Error('cancelOrder not implemented');
  }
  async fetchOrder(orderId: string) {
    throw new Error('fetchOrder not implemented');
  }
  async fetchOpenOrders(symbol?: string) {
    throw new Error('fetchOpenOrders not implemented');
  }
}

export default ExchangeBase;
