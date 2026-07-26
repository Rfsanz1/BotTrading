import { BinanceAdapter } from './adapters/binance.adapter';
import { BybitAdapter } from './adapters/bybit.adapter';
import { OkxAdapter } from './adapters/okx.adapter';
import { MexcAdapter } from './adapters/mexc.adapter';
import { MT5Adapter } from './adapters/mt5.adapter';
import { ExchangeAccount } from './types';

export type ExchangeName = 'binance'|'bybit'|'okx'|'mexc'|'mt5';

export function createExchange(name: ExchangeName, account?: ExchangeAccount) {
  switch (name) {
    case 'binance': return new BinanceAdapter(account);
    case 'bybit': return new BybitAdapter(account);
    case 'okx': return new OkxAdapter(account);
    case 'mexc': return new MexcAdapter(account);
    case 'mt5': return new MT5Adapter(account);
    default: throw new Error('Unsupported exchange: '+name);
  }
}

export function listSupported() { return ['binance','bybit','okx','mexc','mt5'] as ExchangeName[]; }

export default { createExchange, listSupported };
