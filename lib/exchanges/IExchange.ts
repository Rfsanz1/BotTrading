export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'LIMIT' | 'MARKET' | 'STOP' | 'TAKE_PROFIT';

export type Order = {
  id: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  price?: number;
  qty: number;
  status: string;
  timestamp: number;
};

export type Position = {
  symbol: string;
  entryPrice: number;
  qty: number;
  leverage?: number;
  unrealizedPnL?: number;
};

export type Balance = {
  asset: string;
  free: number;
  locked?: number;
};

export interface IExchange {
  // Connection
  connect(config: Record<string, any>): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;

  // Account
  getBalances(): Promise<Balance[]>;
  getPositions(): Promise<Position[]>;

  // Orders
  placeOrder(order: Partial<Order>): Promise<Order>;
  cancelOrder(orderId: string): Promise<void>;
  fetchOrder(orderId: string): Promise<Order | null>;
  fetchOpenOrders(symbol?: string): Promise<Order[]>;

  // Market data (optional)
  fetchTicker?(symbol: string): Promise<Record<string, any>>;
  fetchTrades?(symbol: string, since?: number): Promise<any[]>;
}

export default IExchange;
