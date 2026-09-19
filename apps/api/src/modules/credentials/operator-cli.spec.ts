import { validateTestnetOperatorScope } from './operator-cli';

describe('TESTNET credential operator CLI scope', () => {
  it('accepts only Binance TESTNET account scope', () => {
    expect(() => validateTestnetOperatorScope({
      mode: 'TESTNET',
      exchange: 'BINANCE',
      accountId: 'testnet-account-1',
    })).not.toThrow();
  });

  it.each([
    ['LIVE', 'BINANCE', 'live-account-1'],
    ['TESTNET', 'BINANCE', 'live-account-1'],
    ['TESTNET', 'COINBASE', 'testnet-account-1'],
  ])('rejects unsafe scope %s/%s/%s', (mode, exchange, accountId) => {
    expect(() => validateTestnetOperatorScope({ mode, exchange, accountId })).toThrow();
  });
});
