import { validateLivePreflight } from '../services/live-preflight.service';

const exchange = {
  name: 'binance',
  createProtectionOrder: jest.fn(),
  amendProtectionOrder: jest.fn(),
  cancelProtectionOrder: jest.fn(),
  getProtectionOrder: jest.fn(),
} as any;

const valid = {
  tradingMode: 'LIVE',
  liveTradingEnabled: 'true',
  liveAccountId: 'live-account',
  encryptionKey: 'encrypted-key',
  riskConfigVersion: 'risk-v2',
  risk: {
    TRADING_MIN_ACCOUNT_BALANCE_USD: '50',
    TRADING_MAX_ORDER_VALUE_USD: '500',
    TRADING_DAILY_LOSS_LIMIT_USD: '1000',
    TRADING_MAX_POSITION_SIZE_PERCENT: '10',
    TRADING_MAX_CONCURRENT_POSITIONS: '5',
  },
  databaseReachable: true,
  redisReachable: true,
  canonicalAccountValid: true,
  credentialValid: true,
  symbolMetadataValid: true,
  reconciliationAvailable: true,
  killSwitchAvailable: true,
  exchange,
};

describe('LIVE preflight validation', () => {
  it('accepts complete configuration and capabilities without submitting an order', () => {
    expect(validateLivePreflight(valid)).toEqual({ ok: true, failures: [] });
  });

  it('reports missing configuration and infrastructure failures', () => {
    const result = validateLivePreflight({
      ...valid,
      liveAccountId: undefined,
      risk: { ...valid.risk, TRADING_MAX_ORDER_VALUE_USD: undefined },
      databaseReachable: false,
      canonicalAccountValid: false,
    });
    expect(result.ok).toBe(false);
    expect(result.failures).toEqual(expect.arrayContaining([
      'LIVE_EXCHANGE_ACCOUNT_ID is required',
      'TRADING_MAX_ORDER_VALUE_USD must be a positive finite number',
      'PostgreSQL is unreachable',
      'canonical LIVE account is invalid',
    ]));
  });
});
