export type UUID = string;

export enum MarketType { SPOT = 'spot', MARGIN = 'margin', FUTURES = 'futures' }

export type ExchangeAccount = {
  id: UUID;
  userId: UUID;
  exchange: string;
  credentials?: Record<string, any>;
  isActive: boolean;
  isPaper?: boolean;
};

export type Balance = {
  asset: string;
  free: string;
  locked?: string;
};

export type OrderParams = {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market' | 'stop' | 'take_profit';
  price?: string;
  quantity: string;
  clientOrderId?: string;
  reduceOnly?: boolean;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
};

export type Order = {
  id: UUID;
  clientOrderId?: string;
  externalId?: string;
  symbol: string;
  side: 'buy' | 'sell';
  price?: string;
  quantity: string;
  filled: string;
  status: string;
  createdAt: Date;
  updatedAt?: Date;
  meta?: Record<string, any>;
};

export type Trade = {
  id: UUID;
  orderId?: UUID;
  symbol: string;
  price: string;
  quantity: string;
  fee?: string;
  timestamp: Date;
};

export type Position = {
  id: UUID;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: string;
  quantity: string;
  unrealizedPnl?: string;
  margin?: string;
  status: string;
  openedAt: Date;
  closedAt?: Date;
};

export type MarketTicker = { symbol: string; bid: string; ask: string; last: string; timestamp: number };
