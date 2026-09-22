import { EventEmitter } from 'eventemitter3';
import {
  ExchangeAccount,
  Balance,
  OrderParams,
  Order,
  Position,
  MarketTicker,
  MarketType,
  MarketOrderBook,
  MarketKline,
  ProtectionOrderParams,
  ProtectionOcoOrderParams,
  ProtectionOrder,
} from './types';

export type ExchangeSymbolFilter = {
  filterType: string;
  minPrice?: string;
  maxPrice?: string;
  tickSize?: string;
  minQty?: string;
  maxQty?: string;
  stepSize?: string;
  minNotional?: string;
  applyToMarket?: boolean;
  avgPriceMins?: number;
};

export type ExchangeSymbolInfo = {
  symbol: string;
  status: string;
  filters: ExchangeSymbolFilter[];
};

export interface IExchange extends EventEmitter {
  name: string;
  connect(account: ExchangeAccount): Promise<void>;
  disconnect(): Promise<void>;
  fetchBalances(): Promise<Balance[]>;
  fetchTicker(symbol: string): Promise<MarketTicker>;
  fetchOrderBook?(symbol: string, limit?: number): Promise<MarketOrderBook>;
  fetchRecentKlines?(symbol: string, interval?: string, limit?: number): Promise<MarketKline[]>;
  fetchSymbolInfo?(symbol: string): Promise<ExchangeSymbolInfo>;
  placeOrder(params: OrderParams): Promise<Order>;
  cancelOrder(orderId: string): Promise<void>;
  getOrder(orderId: string, symbol?: string): Promise<Order | null>;
  fetchOpenOrders(symbol?: string): Promise<Order[]>;
  fetchOpenPositions(): Promise<Position[]>;
  createProtectionOrder?(params: ProtectionOrderParams): Promise<ProtectionOrder>;
  createProtectionOco?(params: ProtectionOcoOrderParams): Promise<ProtectionOrder>;
  cancelProtectionOrder?(orderId: string, symbol?: string): Promise<void>;
  getProtectionOrder?(orderId: string, symbol?: string): Promise<ProtectionOrder | null>;
  supportsPositionReconciliation?: boolean;
  nativeProtectionVerified?: boolean;
  subscribeTicker(symbol: string): void;
  unsubscribeTicker(symbol: string): void;
}

export default IExchange;
