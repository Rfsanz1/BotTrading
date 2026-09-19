export type UUID = string;

export enum MarketType { SPOT = 'spot', MARGIN = 'margin', FUTURES = 'futures' }

export type ExchangeAccount = {
  id: UUID;
  userId: UUID;
  exchange: string;
  accountId?: string;
  credentials?: Record<string, any>;
  isActive: boolean;
  isPaper?: boolean;
  tradingMode?: 'PAPER' | 'TESTNET' | 'LIVE';
};

export type Balance = {
  asset: string;
  free: string;
  locked?: string;
};

export type OrderParams = {
  symbol: string;
  side: 'buy' | 'sell';
  type: 'limit' | 'market' | 'stop' | 'take_profit' | 'stop_loss_limit' | 'take_profit_limit';
  price?: string;
  triggerPrice?: string;
  quantity: string;
  clientOrderId?: string;
  reduceOnly?: boolean;
  intent?: 'ENTRY' | 'EXIT' | 'REDUCE' | 'CLOSE' | 'REVERSAL';
  positionId?: string;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
};

export type ProtectionKind = 'STOP_LOSS' | 'TAKE_PROFIT';
export type ProtectionState = 'PENDING' | 'SUBMITTED' | 'CONFIRMED' | 'FAILED' | 'UNKNOWN' | 'CANCELED';

export type ProtectionOrderParams = {
  symbol: string;
  side: 'buy' | 'sell';
  quantity: string;
  triggerPrice: string;
  limitPrice: string;
  clientOrderId: string;
  kind: ProtectionKind;
  timeInForce?: 'GTC' | 'IOC' | 'FOK';
};

export type ProtectionOrder = {
  id: string;
  clientOrderId?: string;
  externalId?: string;
  symbol: string;
  side: 'buy' | 'sell';
  quantity: string;
  triggerPrice: string;
  limitPrice: string;
  kind: ProtectionKind;
  status: string;
  state: ProtectionState;
  createdAt: Date;
  updatedAt: Date;
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

export type OrderBookLevel = [string, string];

export type MarketOrderBook = {
  symbol: string;
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  timestamp: number;
};

export type MarketKline = {
  symbol: string;
  close: string;
  timestamp: number;
};
