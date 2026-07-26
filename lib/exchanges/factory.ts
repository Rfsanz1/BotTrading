import BinanceAdapter from './adapters/binance';
import BybitAdapter from './adapters/bybit';
import OkxAdapter from './adapters/okx';
import MexcAdapter from './adapters/mexc';
import MT5Adapter from './adapters/mt5';
import FutureAdapter from './adapters/futureAdapter';
import IExchange from './IExchange';

export type ExchangeName = 'binance' | 'bybit' | 'okx' | 'mexc' | 'mt5' | 'future';

export function createExchange(name: ExchangeName, config: Record<string, any>): IExchange {
  switch (name) {
    case 'binance':
      return new BinanceAdapter();
    case 'bybit':
      return new BybitAdapter();
    case 'okx':
      return new OkxAdapter();
    case 'mexc':
      return new MexcAdapter();
    case 'mt5':
      return new MT5Adapter();
    case 'future':
    default:
      return new FutureAdapter();
  }
}

export default createExchange;
