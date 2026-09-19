import { IExchange } from '../IExchange';

export type LivePreflightInput = {
  tradingMode?: string;
  liveTradingEnabled?: string;
  liveAccountId?: string;
  encryptionKey?: string;
  riskConfigVersion?: string;
  risk: Record<string, string | undefined>;
  databaseReachable: boolean;
  redisReachable: boolean;
  canonicalAccountValid: boolean;
  credentialValid: boolean;
  symbolMetadataValid: boolean;
  reconciliationAvailable: boolean;
  killSwitchAvailable: boolean;
  exchange: IExchange;
};

export type LivePreflightResult = {
  ok: boolean;
  failures: string[];
};

const riskNames = [
  'TRADING_MIN_ACCOUNT_BALANCE_USD',
  'TRADING_MAX_ORDER_VALUE_USD',
  'TRADING_DAILY_LOSS_LIMIT_USD',
  'TRADING_MAX_POSITION_SIZE_PERCENT',
  'TRADING_MAX_CONCURRENT_POSITIONS',
] as const;

export function validateLivePreflight(input: LivePreflightInput): LivePreflightResult {
  const failures: string[] = [];
  if (input.tradingMode !== 'LIVE') failures.push('TRADING_MODE must be LIVE');
  if (input.liveTradingEnabled !== 'true') failures.push('LIVE_TRADING_ENABLED must be true');
  if (!input.liveAccountId) failures.push('LIVE_EXCHANGE_ACCOUNT_ID is required');
  if (!input.encryptionKey) failures.push('EXCHANGE_CREDENTIAL_ENCRYPTION_KEY is required');
  if (!input.riskConfigVersion) failures.push('RISK_CONFIG_VERSION is required');
  for (const name of riskNames) {
    const raw = input.risk[name];
    const value = raw === undefined ? NaN : Number(raw);
    if (!Number.isFinite(value) || value <= 0) failures.push(`${name} must be a positive finite number`);
  }
  const maxPosition = Number(input.risk.TRADING_MAX_POSITION_SIZE_PERCENT);
  const maxConcurrent = Number(input.risk.TRADING_MAX_CONCURRENT_POSITIONS);
  const minBalance = Number(input.risk.TRADING_MIN_ACCOUNT_BALANCE_USD);
  const maxOrder = Number(input.risk.TRADING_MAX_ORDER_VALUE_USD);
  if (Number.isFinite(maxPosition) && maxPosition > 100) failures.push('TRADING_MAX_POSITION_SIZE_PERCENT must not exceed 100');
  if (Number.isFinite(maxConcurrent) && !Number.isInteger(maxConcurrent)) failures.push('TRADING_MAX_CONCURRENT_POSITIONS must be an integer');
  if (Number.isFinite(minBalance) && Number.isFinite(maxOrder) && maxOrder < minBalance) failures.push('TRADING_MAX_ORDER_VALUE_USD must not be below minimum balance');
  if (!input.databaseReachable) failures.push('PostgreSQL is unreachable');
  if (!input.redisReachable) failures.push('Redis is unreachable');
  if (!input.canonicalAccountValid) failures.push('canonical LIVE account is invalid');
  if (!input.credentialValid) failures.push('canonical LIVE credential is invalid');
  if (!input.symbolMetadataValid) failures.push('symbol metadata/filter validation is unavailable');
  if (!input.reconciliationAvailable) failures.push('reconciliation service is unavailable');
  if (!input.killSwitchAvailable) failures.push('kill switch is unavailable');
  if (input.exchange.name !== 'binance') failures.push('LIVE preflight requires Binance adapter');
  if (!input.exchange.createProtectionOrder || !input.exchange.amendProtectionOrder || !input.exchange.cancelProtectionOrder || !input.exchange.getProtectionOrder) {
    failures.push('native protection capability is incomplete');
  }
  return { ok: failures.length === 0, failures };
}
