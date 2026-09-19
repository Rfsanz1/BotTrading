import { validateEnv } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://user:password@localhost:5432/trading',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
  JWT_ISSUER: 'bottrading',
  JWT_AUDIENCE: 'bottrading-dashboard',
  TRADING_MODE: 'LIVE',
  LIVE_TRADING_ENABLED: 'true',
  EXCHANGE_CREDENTIAL_ENCRYPTION_KEY: 'c'.repeat(32),
  LIVE_EXCHANGE_ACCOUNT_ID: '11111111-1111-4111-8111-111111111111',
  RISK_CONFIG_VERSION: 'live-risk-2026-01',
  TRADING_MIN_ACCOUNT_BALANCE_USD: '50',
  TRADING_MAX_ORDER_VALUE_USD: '500',
  TRADING_DAILY_LOSS_LIMIT_USD: '1000',
  TRADING_MAX_POSITION_SIZE_PERCENT: '10',
  TRADING_MAX_CONCURRENT_POSITIONS: '5',
};

describe('LIVE environment validation', () => {
  it('fails closed when a required risk value is absent', () => {
    const env: Record<string, string> = { ...base };
    delete env.TRADING_MAX_ORDER_VALUE_USD;
    expect(() => validateEnv(env)).toThrow(/TRADING_MAX_ORDER_VALUE_USD/);
  });

  it('rejects malformed, non-positive, and inconsistent limits', () => {
    expect(() => validateEnv({ ...base, TRADING_DAILY_LOSS_LIMIT_USD: 'nope' })).toThrow(/TRADING_DAILY_LOSS_LIMIT_USD/);
    expect(() => validateEnv({ ...base, TRADING_MAX_POSITION_SIZE_PERCENT: '0' })).toThrow(/TRADING_MAX_POSITION_SIZE_PERCENT/);
    expect(() => validateEnv({ ...base, TRADING_MAX_ORDER_VALUE_USD: '25' })).toThrow(/TRADING_MAX_ORDER_VALUE_USD/);
  });

  it('accepts a complete explicit LIVE configuration', () => {
    expect(validateEnv(base).TRADING_MODE).toBe('LIVE');
  });
});
