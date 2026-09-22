import { BinanceAdapter } from './adapters/binance.adapter';
import { ExchangeAccount } from './types';
import { FakePaperExchangeAdapter } from './adapters/fake-paper.adapter';
import { resolveExecutionCapability } from './services/execution-mode.service';

export type ExchangeName = 'binance'|'paper';

export function createExchange(name: ExchangeName, account?: ExchangeAccount) {
  if (!account?.tradingMode) {
    throw new Error('Exchange execution requires explicit tradingMode');
  }
  const capability = resolveExecutionCapability(name);
  if (account.tradingMode !== capability.mode) {
    throw new Error(`Exchange account mode ${account.tradingMode} does not match runtime mode ${capability.mode}`);
  }
  if (account.isPaper !== (capability.mode === 'PAPER')) {
    throw new Error(`Exchange account isPaper=${account.isPaper} does not match runtime mode ${capability.mode}`);
  }
  switch (name) {
    case 'binance': return new BinanceAdapter(account);
    case 'paper': {
      if (capability.mode !== 'PAPER') throw new Error('Paper adapter requires TRADING_MODE=PAPER');
      const mode = process.env.TRADING_MODE === 'PAPER' ? process.env.PAPER_TEST_FILL_MODE : undefined;
      const fillModes = new Set([
        'accepted',
        'partial',
        'duplicate-fill',
        'fill-cancel-race',
        'reject',
        'cancelled',
        'timeout',
        'unknown',
      ]);
      return new FakePaperExchangeAdapter(account, {
        fillMode: mode && fillModes.has(mode) ? mode as any : undefined,
        partialFillRatio: process.env.PAPER_TEST_PARTIAL_RATIO ? Number(process.env.PAPER_TEST_PARTIAL_RATIO) : undefined,
      });
    }
    default: throw new Error('Unsupported exchange: '+name);
  }
}

export function listSupported() { return ['binance','paper'] as ExchangeName[]; }

export default { createExchange, listSupported };
