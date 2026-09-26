import { Injectable } from '@nestjs/common';
import { toBinanceSpotInterval } from './binance-interval';

export type BinanceClientFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface BinanceKline {
  openTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  closeTime: number;
  quoteVolume: number;
  tradeCount: number;
  takerBuyBaseVolume: number;
  takerBuyQuoteVolume: number;
}

export interface BinanceOrderBook {
  lastUpdateId: number;
  bids: Array<[number, number]>;
  asks: Array<[number, number]>;
}

export interface BinanceExchangeInfoSymbol {
  symbol: string;
  status: string;
  baseAsset: string;
  quoteAsset: string;
  isSpotTradingAllowed?: boolean;
  isMarginTradingAllowed?: boolean;
  filters?: unknown[];
  permissions?: unknown[];
  permissionSets?: unknown[];
  onboardDate?: number;
}

export function hasSpotPermission(symbol: Pick<BinanceExchangeInfoSymbol, 'permissions' | 'permissionSets'>): boolean {
  if (Array.isArray(symbol.permissions) && symbol.permissions.length > 0) {
    return symbol.permissions.includes('SPOT');
  }

  if (Array.isArray(symbol.permissionSets)) {
    return flattenPermissionValues(symbol.permissionSets).includes('SPOT');
  }

  return true;
}

function flattenPermissionValues(value: unknown): string[] {
  if (!Array.isArray(value)) return typeof value === 'string' ? [value] : [];
  return value.flatMap((item) => flattenPermissionValues(item));
}

export interface BinanceExchangeInfo {
  symbols: BinanceExchangeInfoSymbol[];
}

@Injectable()
export class BinanceMarketClient {
  private readonly spotBaseUrl = 'https://api.binance.com';
  private readonly futuresBaseUrl = 'https://fapi.binance.com';

  constructor(private readonly fetcher: BinanceClientFetch = fetch) {}

  async fetchJson<T>(path: string, params: Record<string, string | number> = {}, futures = false): Promise<T> {
    const baseUrl = futures ? this.futuresBaseUrl : this.spotBaseUrl;
    const query = new URLSearchParams(Object.entries(params).map(([key, value]) => [key, String(value)] as [string, string]));
    const url = `${baseUrl}${path}${query.size ? `?${query.toString()}` : ''}`;
    const response = await this.fetcher(url, { signal: AbortSignal.timeout(5_000) });
    const body = await response.text();
    if (!response.ok) {
      let parsed: { code?: number; msg?: string } = {};
      try {
        parsed = JSON.parse(body) as { code?: number; msg?: string };
      } catch {
        // Keep the response body out of logs when it is not structured Binance JSON.
      }
      const symbol = params.symbol ? ` symbol=${String(params.symbol)}` : '';
      const interval = params.interval ? ` interval=${String(params.interval)}` : '';
      const binanceCode = parsed.code === undefined ? '' : ` binanceCode=${parsed.code}`;
      const binanceMessage = parsed.msg ? ` binanceMessage=${parsed.msg}` : '';
      throw new Error(`Binance HTTP error: status=${response.status} endpoint=${path}${symbol}${interval}${binanceCode}${binanceMessage}`);
    }
    return JSON.parse(body) as T;
  }

  async klines(symbol: string, timeframe: string, limit = 200, futures = false): Promise<BinanceKline[]> {
    const normalizedSymbol = normalizeSymbol(symbol);
    const interval = toBinanceSpotInterval(timeframe);
    const path = futures ? '/fapi/v1/klines' : '/api/v3/klines';
    const rows = await this.fetchJson<unknown[][]>(path, { symbol: normalizedSymbol, interval, limit }, futures);
    return rows.map((row) => {
      if (row.length < 12) throw new Error('Invalid Binance kline payload');
      return {
        openTime: Number(row[0]),
        open: Number(row[1]),
        high: Number(row[2]),
        low: Number(row[3]),
        close: Number(row[4]),
        volume: Number(row[5]),
        closeTime: Number(row[6]),
        quoteVolume: Number(row[7]),
        tradeCount: Number(row[8]),
        takerBuyBaseVolume: Number(row[9]),
        takerBuyQuoteVolume: Number(row[10]),
      };
    });
  }

  async spotExchangeInfo(): Promise<BinanceExchangeInfo> {
    return this.fetchJson<BinanceExchangeInfo>('/api/v3/exchangeInfo');
  }

  async ticker(symbol: string): Promise<{ symbol: string; price: number; eventTime: number }> {
    const row = await this.fetchJson<{ symbol: string; price: string }>('/api/v3/ticker/price', { symbol: normalizeSymbol(symbol) });
    return { symbol: row.symbol, price: toFiniteNumber(row.price, 'ticker price'), eventTime: Date.now() };
  }

  async orderBook(symbol: string, limit = 100): Promise<BinanceOrderBook> {
    const row = await this.fetchJson<{ lastUpdateId: number; bids: string[][]; asks: string[][] }>('/api/v3/depth', {
      symbol: normalizeSymbol(symbol),
      limit,
    });
    return {
      lastUpdateId: Number(row.lastUpdateId),
      bids: row.bids.map(([price, quantity]) => [toFiniteNumber(price, 'bid price'), toFiniteNumber(quantity, 'bid quantity')]),
      asks: row.asks.map(([price, quantity]) => [toFiniteNumber(price, 'ask price'), toFiniteNumber(quantity, 'ask quantity')]),
    };
  }

  async funding(symbol: string): Promise<{ fundingRate: number; fundingTime: number }> {
    const rows = await this.fetchJson<Array<{ fundingRate: string; fundingTime: number }>>('/fapi/v1/fundingRate', {
      symbol: normalizeSymbol(symbol),
      limit: 1,
    }, true);
    const row = rows[0];
    if (!row) throw new Error('Binance funding payload is empty');
    return { fundingRate: toFiniteNumber(row.fundingRate, 'funding rate'), fundingTime: Number(row.fundingTime) };
  }

  async fundingHistory(symbol: string, limit = 100): Promise<Array<{ fundingRate: number; fundingTime: number }>> {
    const rows = await this.fetchJson<Array<{ fundingRate: string; fundingTime: number }>>('/fapi/v1/fundingRate', {
      symbol: normalizeSymbol(symbol),
      limit,
    }, true);
    return rows.map((row) => ({
      fundingRate: toFiniteNumber(row.fundingRate, 'funding rate'),
      fundingTime: Number(row.fundingTime),
    }));
  }

  async openInterest(symbol: string): Promise<{ openInterest: number; time: number }> {
    const row = await this.fetchJson<{ openInterest: string; time: number }>('/fapi/v1/openInterest', {
      symbol: normalizeSymbol(symbol),
    }, true);
    return { openInterest: toFiniteNumber(row.openInterest, 'open interest'), time: Number(row.time) };
  }

  async openInterestHistory(symbol: string, period = '5m', limit = 100): Promise<Array<{ openInterest: number; timestamp: number }>> {
    const rows = await this.fetchJson<Array<{ sumOpenInterest: string; timestamp: number }>>('/futures/data/openInterestHist', {
      symbol: normalizeSymbol(symbol),
      period,
      limit,
    }, true);
    return rows.map((row) => ({
      openInterest: toFiniteNumber(row.sumOpenInterest, 'historical open interest'),
      timestamp: Number(row.timestamp),
    }));
  }
}

export function normalizeSymbol(symbol: string): string {
  const normalized = symbol.replace(/[\/-]/g, '').trim().toUpperCase();
  if (!/^[A-Z0-9]{5,20}$/.test(normalized)) throw new Error(`Invalid Binance symbol: ${symbol}`);
  return normalized;
}

function toFiniteNumber(value: string | number, field: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid Binance ${field}`);
  return parsed;
}
