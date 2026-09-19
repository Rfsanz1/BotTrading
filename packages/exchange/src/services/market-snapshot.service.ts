import { IExchange } from '../IExchange';
import { MarketKline, MarketOrderBook } from '../types';

export type CanonicalMarketSnapshot = {
  symbol: string;
  bid: number;
  ask: number;
  mid: number;
  spread: number;
  spreadBps: number;
  liquidity: number;
  slippage: number;
  volatility: number;
  timestamp: number;
  stale: boolean;
  source: string;
  authority: string;
};

export type MarketSnapshotRequest = {
  symbol: string;
  side: 'BUY' | 'SELL';
  quantity: number;
  now?: number;
  maxAgeMs?: number;
};

function finitePositive(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error('Market data contains an invalid positive number');
  return parsed;
}

function validateSymbol(symbol: string, expected: string): void {
  if (symbol !== expected) throw new Error(`Market data symbol mismatch: expected ${expected}, received ${symbol}`);
}

function validateBook(book: MarketOrderBook, symbol: string): void {
  validateSymbol(book.symbol, symbol);
  if (!book.bids.length || !book.asks.length || !Number.isFinite(book.timestamp)) {
    throw new Error('Market order book is incomplete');
  }
}

export function calculateVolatility(klines: MarketKline[], symbol: string): number {
  if (klines.length < 3) throw new Error('Insufficient market history for volatility');
  const ordered = [...klines].sort((a, b) => a.timestamp - b.timestamp);
  ordered.forEach((kline) => {
    validateSymbol(kline.symbol, symbol);
    finitePositive(kline.close);
  });
  const returns = ordered.slice(1).map((kline, index) => Math.log(Number(kline.close) / Number(ordered[index].close)));
  const mean = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - mean) ** 2, 0) / returns.length;
  const volatility = Math.sqrt(variance);
  if (!Number.isFinite(volatility)) throw new Error('Volatility calculation failed');
  return volatility;
}

export function calculateBookExecution(
  book: MarketOrderBook,
  side: 'BUY' | 'SELL',
  quantity: number,
  mid: number,
): { slippage: number; depthNotional: number } {
  validateBook(book, book.symbol);
  const levels = (side === 'BUY' ? book.asks : book.bids)
    .map(([price, amount]) => ({ price: finitePositive(price), amount: finitePositive(amount) }))
    .sort((a, b) => side === 'BUY' ? a.price - b.price : b.price - a.price);
  let remaining = finitePositive(quantity);
  let notional = 0;
  let filled = 0;
  for (const level of levels) {
    const take = Math.min(remaining, level.amount);
    notional += take * level.price;
    filled += take;
    remaining -= take;
    if (remaining <= Number.EPSILON) break;
  }
  if (remaining > Number.EPSILON) throw new Error('Insufficient order-book depth for requested quantity');
  const average = notional / filled;
  return {
    slippage: Math.abs(average - mid) / mid,
    depthNotional: levels.reduce((sum, level) => sum + level.price * level.amount, 0),
  };
}

export async function fetchCanonicalMarketSnapshot(
  exchange: IExchange,
  request: MarketSnapshotRequest,
): Promise<CanonicalMarketSnapshot> {
  if (!exchange.fetchOrderBook || !exchange.fetchRecentKlines) {
    throw new Error(`Exchange ${exchange.name} does not provide canonical market depth/history`);
  }
  const now = request.now ?? Date.now();
  const maxAgeMs = request.maxAgeMs ?? 15_000;
  const [ticker, book, klines] = await Promise.all([
    exchange.fetchTicker(request.symbol),
    exchange.fetchOrderBook(request.symbol, 20),
    exchange.fetchRecentKlines(request.symbol, '1m', 30),
  ]);
  validateSymbol(ticker.symbol, request.symbol);
  validateBook(book, request.symbol);
  if (!Number.isFinite(ticker.timestamp) || Math.abs(now - ticker.timestamp) > maxAgeMs) {
    throw new Error('Market ticker is stale');
  }
  if (Math.abs(ticker.timestamp - book.timestamp) > maxAgeMs) {
    throw new Error('Market ticker and order book timestamps do not match');
  }
  const bid = finitePositive(ticker.bid);
  const ask = finitePositive(ticker.ask);
  if (bid >= ask) throw new Error('Market bid must be lower than ask');
  const mid = (bid + ask) / 2;
  const spread = (ask - bid) / mid;
  const execution = calculateBookExecution(book, request.side, request.quantity, mid);
  const liquidity = execution.depthNotional / (execution.depthNotional + (mid * request.quantity));
  const volatility = calculateVolatility(klines, request.symbol);
  const latestKlineTimestamp = Math.max(...klines.map((kline) => kline.timestamp));
  const timestamp = Math.min(ticker.timestamp, book.timestamp, latestKlineTimestamp);
  const stale = now - timestamp > maxAgeMs;
  if (stale) throw new Error('Canonical market snapshot is stale');
  return {
    symbol: request.symbol,
    bid,
    ask,
    mid,
    spread,
    spreadBps: spread * 10_000,
    liquidity,
    slippage: execution.slippage,
    volatility,
    timestamp,
    stale,
    source: exchange.name,
    authority: 'EXCHANGE_ORDERBOOK_AND_KLINES',
  };
}
