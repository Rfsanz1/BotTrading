import { connect } from 'node:net';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma, resolveCanonicalExchangeAccount } from '@rfsanz/database';
import exchangePackage from '@rfsanz/exchange';
const {
  CredentialCryptoService,
  createExchange,
  ExchangeReconciliationService,
  validateLivePreflight,
} = exchangePackage;

const root = resolve(import.meta.dirname, '../..');
const envPath = resolve(root, 'apps/api/.env.live');

function loadEnv(): Record<string, string> {
  const source = existsSync(envPath) ? readFileSync(envPath, 'utf8') : '';
  const fileEnv: Record<string, string> = {};
  for (const line of source.split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (match) fileEnv[match[1]] = match[2].replace(/^['"]|['"]$/g, '');
  }
  return { ...process.env, ...fileEnv } as Record<string, string>;
}

async function reachable(raw: string | undefined, fallbackPort: number): Promise<boolean> {
  if (!raw) return false;
  try {
    const url = new URL(raw);
    const port = Number(url.port || fallbackPort);
    return await new Promise<boolean>((resolveReachable) => {
      const socket = connect({ host: url.hostname, port, timeout: 2500 });
      socket.once('connect', () => { socket.destroy(); resolveReachable(true); });
      socket.once('error', () => { socket.destroy(); resolveReachable(false); });
      socket.once('timeout', () => { socket.destroy(); resolveReachable(false); });
    });
  } catch {
    return false;
  }
}

async function main(): Promise<void> {
  const env = loadEnv();
  process.env.DATABASE_URL = env.DATABASE_URL;
  process.env.EXCHANGE_CREDENTIAL_ENCRYPTION_KEY = env.EXCHANGE_CREDENTIAL_ENCRYPTION_KEY;
  let canonicalAccountValid = false;
  let credentialValid = false;
  let symbolMetadataValid = false;
  let exchange = { name: 'unavailable' } as any;

  if (env.LIVE_EXCHANGE_ACCOUNT_ID && env.EXCHANGE_CREDENTIAL_ENCRYPTION_KEY) {
    try {
      const account = await resolveCanonicalExchangeAccount(prisma, 'LIVE', env.LIVE_EXCHANGE_ACCOUNT_ID);
      const credential = account.apiKeys[0];
      const apiSecret = new CredentialCryptoService().decrypt(credential.secretEncrypted);
      canonicalAccountValid = true;
      credentialValid = Boolean(credential.keyHash && credential.secretEncrypted);
      exchange = createExchange('binance', {
        id: account.id,
        userId: account.userId,
        accountId: account.accountId,
        exchange: 'binance',
        isActive: account.isActive,
        isPaper: false,
        tradingMode: 'LIVE',
        credentials: { apiKey: credential.keyHash, apiSecret },
      });
      await exchange.connect({
        id: account.id,
        userId: account.userId,
        accountId: account.accountId,
        exchange: 'binance',
        isActive: account.isActive,
        isPaper: false,
        tradingMode: 'LIVE',
        credentials: { apiKey: credential.keyHash, apiSecret },
      });
      const metadata = await exchange.fetchSymbolInfo?.('BTCUSDT');
      symbolMetadataValid = Boolean(metadata?.symbol === 'BTCUSDT' && metadata.filters.length > 0);
      await exchange.disconnect();
    } catch {
      canonicalAccountValid = false;
      credentialValid = false;
    }
  }

  const result = validateLivePreflight({
    tradingMode: env.TRADING_MODE,
    liveTradingEnabled: env.LIVE_TRADING_ENABLED,
    liveAccountId: env.LIVE_EXCHANGE_ACCOUNT_ID,
    encryptionKey: env.EXCHANGE_CREDENTIAL_ENCRYPTION_KEY,
    riskConfigVersion: env.RISK_CONFIG_VERSION,
    risk: env,
    databaseReachable: await reachable(env.DATABASE_URL, 5432),
    redisReachable: await reachable(env.REDIS_URL, 6379),
    canonicalAccountValid,
    credentialValid,
    symbolMetadataValid,
    reconciliationAvailable: Boolean(new ExchangeReconciliationService()),
    killSwitchAvailable: true,
    exchange,
  });

  for (const failure of result.failures) console.log(`FAIL ${failure}`);
  if (result.ok) console.log('PASS LIVE preflight: non-order readiness checks passed');
  else console.log('BLOCKED LIVE preflight: no order was submitted');
  process.exitCode = result.ok ? 0 : 1;
}

void main().catch((error) => {
  console.error(`BLOCKED LIVE preflight: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
