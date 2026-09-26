export type InternalTimeframe =
  | '1M'
  | '5M'
  | '15M'
  | '30M'
  | '1H'
  | '4H'
  | '1D'
  | '1W'
  | '1m'
  | '5m'
  | '15m'
  | '30m'
  | '1h'
  | '4h'
  | '1d'
  | '1w';

const BINANCE_SPOT_INTERVALS: Record<InternalTimeframe, string> = {
  '1M': '1m',
  '5M': '5m',
  '15M': '15m',
  '30M': '30m',
  '1H': '1h',
  '4H': '4h',
  '1D': '1d',
  '1W': '1w',
  '1m': '1m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '1d': '1d',
  '1w': '1w',
};

export function toBinanceSpotInterval(timeframe: string): string {
  const interval = BINANCE_SPOT_INTERVALS[timeframe as InternalTimeframe];
  if (!interval) throw new Error(`Invalid internal timeframe: ${timeframe}`);
  return interval;
}

export function toBinanceStreamName(stream: string): string {
  const match = /^(.+@kline_)([^@]+)$/i.exec(stream.trim());
  if (!match) return stream.trim().toLowerCase();
  return `${match[1].toLowerCase()}${toBinanceSpotInterval(match[2])}`;
}
