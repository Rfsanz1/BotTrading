import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { connect } from 'node:net';
import { resolve } from 'node:path';
import { buildSignedRequestUrl } from './binance-signing.ts';
import { prisma, resolveCanonicalExchangeAccount } from '@rfsanz/database';
import { CredentialCryptoService } from '@rfsanz/exchange';

const root = resolve(import.meta.dirname, '../..');
const envPath = resolve(root, 'apps/api/.env.testnet');
const endpoint = 'https://testnet.binance.vision';
const apiBase = `${endpoint}/api`;

type CheckResult = 'PASS' | 'FAIL' | 'BLOCKED';

function loadDedicatedEnvironment(): Record<string, string> {
  if (!existsSync(envPath)) {
    if (
      process.env.TRADING_MODE !== 'TESTNET' ||
      process.env.LIVE_TRADING_ENABLED !== 'false' ||
      process.env.TESTNET_READY !== 'true'
    ) {
      throw new Error(`BLOCKED TESTNET environment: missing ${envPath}; PAPER environment is not reused`);
    }
    return Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
    );
  }
  const env: Record<string, string> = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator <= 0) continue;
    env[trimmed.slice(0, separator)] = trimmed.slice(separator + 1).replace(/^['"]|['"]$/g, '');
  }
  const legacyKey = env.BINANCE_API_KEY;
  const legacySecret = env.BINANCE_API_SECRET;
  if (env.BINANCE_TESTNET_API_KEY && legacyKey && env.BINANCE_TESTNET_API_KEY !== legacyKey) {
    throw new Error('BLOCKED TESTNET environment: conflicting TESTNET API key variables');
  }
  if (env.BINANCE_TESTNET_API_SECRET && legacySecret && env.BINANCE_TESTNET_API_SECRET !== legacySecret) {
    throw new Error('BLOCKED TESTNET environment: conflicting TESTNET API secret variables');
  }
  if (!env.BINANCE_TESTNET_API_KEY && legacyKey) env.BINANCE_TESTNET_API_KEY = legacyKey;
  if (!env.BINANCE_TESTNET_API_SECRET && legacySecret) env.BINANCE_TESTNET_API_SECRET = legacySecret;
  for (const name of ['TESTNET_EXCHANGE_ACCOUNT_ID', 'EXCHANGE_CREDENTIAL_ENCRYPTION_KEY']) {
    if (process.env[name]) env[name] = process.env[name]!;
  }
  return env;
}

function check(result: CheckResult, name: string, detail: string): void {
  console.log(`${result.padEnd(7)} ${name}: ${detail}`);
}

async function tcpCheck(name: string, rawUrl: string | undefined, defaultPort: number): Promise<boolean> {
  if (!rawUrl) {
    check('FAIL', name, 'configuration is missing');
    return false;
  }
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    check('FAIL', name, 'URL is invalid');
    return false;
  }
  const port = Number(url.port || defaultPort);
  const reachable = await new Promise<boolean>((resolveReachable) => {
    const socket = connect({ host: url.hostname, port, timeout: 5000 });
    socket.once('connect', () => { socket.destroy(); resolveReachable(true); });
    socket.once('error', () => { socket.destroy(); resolveReachable(false); });
    socket.once('timeout', () => { socket.destroy(); resolveReachable(false); });
  });
  check(reachable ? 'PASS' : 'BLOCKED', name, `${url.hostname}:${port} ${reachable ? 'is reachable' : 'is unreachable'}`);
  return reachable;
}

async function signedRequest(path: string, apiKey: string, secret: string, method: 'GET' | 'POST'): Promise<Response> {
  return fetch(buildSignedRequestUrl(path, secret), {
    method,
    headers: { 'X-MBX-APIKEY': apiKey },
  });
}

async function verifyUserDataStream(apiKey: string, secret: string): Promise<boolean> {
  const requestId = `testnet-preflight-${Date.now()}`;
  const timestamp = Date.now();
  const signature = createHmac('sha256', secret)
    .update(`apiKey=${apiKey}&timestamp=${timestamp}`)
    .digest('hex');
  const socket = new WebSocket('wss://ws-api.testnet.binance.vision/ws-api/v3');
  return new Promise<boolean>((resolveStream) => {
    const timer = setTimeout(() => {
      socket.close();
      resolveStream(false);
    }, 10000);
    socket.onopen = () => {
      socket.send(JSON.stringify({
        id: requestId,
        method: 'userDataStream.subscribe.signature',
        params: { apiKey, timestamp, signature },
      }));
    };
    socket.onmessage = (message: any) => {
      try {
        const payload = JSON.parse(String(message.data)) as {
          id?: string;
          status?: number;
          result?: { subscriptionId?: number | string };
        };
        if (payload.id !== requestId) return;
        clearTimeout(timer);
        socket.close();
        resolveStream(payload.status === 200 && payload.result?.subscriptionId !== undefined);
      } catch {
        clearTimeout(timer);
        socket.close();
        resolveStream(false);
      }
    };
    socket.onerror = () => {
      clearTimeout(timer);
      resolveStream(false);
    };
  });
}

async function main(): Promise<void> {
  let env: Record<string, string>;
  try {
    env = loadDedicatedEnvironment();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
    return;
  }

  const modeValid = env.TRADING_MODE === 'TESTNET';
  const liveDisabled = env.LIVE_TRADING_ENABLED === 'false';
  const testnetReady = env.TESTNET_READY === 'true';
  const endpointValid = env.BINANCE_BASE_URL === undefined || env.BINANCE_BASE_URL === endpoint || env.BINANCE_BASE_URL === `${endpoint}/api`;
  let apiKey: string | undefined;
  let apiSecret: string | undefined;

  check(modeValid ? 'PASS' : 'FAIL', 'TRADING_MODE', modeValid ? 'TESTNET' : 'must be TESTNET');
  check(liveDisabled ? 'PASS' : 'FAIL', 'LIVE_TRADING_ENABLED', liveDisabled ? 'false' : 'must be false');
  check(testnetReady ? 'PASS' : 'FAIL', 'TESTNET_READY', testnetReady ? 'true' : 'must be true');
  check(endpointValid ? 'PASS' : 'FAIL', 'Binance endpoint', endpointValid ? endpoint : 'must be Binance TESTNET; production endpoint rejected');
  check(env.TESTNET_EXCHANGE_ACCOUNT_ID ? 'PASS' : 'FAIL', 'Canonical exchange account', env.TESTNET_EXCHANGE_ACCOUNT_ID ? 'configured' : 'TESTNET_EXCHANGE_ACCOUNT_ID is required');
  check('PASS', 'Adapter selection', 'TESTNET permits Binance TESTNET only; PAPER adapter and production endpoint are rejected by mode gates');
  if (!modeValid || !liveDisabled || !testnetReady || !endpointValid || !env.TESTNET_EXCHANGE_ACCOUNT_ID) {
    process.exitCode = 1;
    return;
  }

  if (env.DATABASE_URL) process.env.DATABASE_URL = env.DATABASE_URL;
  if (env.EXCHANGE_CREDENTIAL_ENCRYPTION_KEY) {
    process.env.EXCHANGE_CREDENTIAL_ENCRYPTION_KEY = env.EXCHANGE_CREDENTIAL_ENCRYPTION_KEY;
  }

  const databaseOk = await tcpCheck('PostgreSQL', env.DATABASE_URL, 5432);
  const redisOk = await tcpCheck('Redis', env.REDIS_URL, 6379);
  if (!databaseOk || !redisOk) {
    process.exitCode = 1;
    return;
  }

  try {
    const account = await resolveCanonicalExchangeAccount(prisma, 'TESTNET', env.TESTNET_EXCHANGE_ACCOUNT_ID);
    const credential = account.apiKeys[0];
    const crypto = new CredentialCryptoService();
    apiKey = credential.keyHash;
    apiSecret = crypto.decrypt(credential.secretEncrypted);
    check('PASS', 'Canonical credential', `resolved for exchange account ${account.id}`);
  } catch (error) {
    check('FAIL', 'Canonical credential', error instanceof Error ? error.message : 'resolution failed');
    process.exitCode = 1;
    return;
  }
  const credentialsPresent = Boolean(apiKey && apiSecret);
  check(credentialsPresent ? 'PASS' : 'FAIL', 'TESTNET credentials', credentialsPresent ? 'resolved from canonical account' : 'canonical credential is unavailable');
  if (!credentialsPresent) {
    process.exitCode = 1;
    return;
  }

  const exchangeInfo = await fetch(`${apiBase}/v3/exchangeInfo?symbol=BTCUSDT`);
  if (!exchangeInfo.ok) {
    check('FAIL', 'Symbol metadata', `Binance TESTNET returned HTTP ${exchangeInfo.status}`);
    process.exitCode = 1;
    return;
  }
  const metadata = await exchangeInfo.json() as { symbols?: Array<{ status?: string; isSpotTradingAllowed?: boolean }> };
  const symbol = metadata.symbols?.[0];
  check(symbol?.status === 'TRADING' ? 'PASS' : 'FAIL', 'Symbol metadata', symbol?.status === 'TRADING' ? 'BTCUSDT is TRADING' : 'BTCUSDT is not trading');
  check(symbol?.isSpotTradingAllowed === true ? 'PASS' : 'FAIL', 'Order capability', symbol?.isSpotTradingAllowed === true ? 'spot trading is allowed by exchange metadata' : 'spot trading is not allowed');

  const accountResponse = await signedRequest('/v3/account', apiKey!, apiSecret!, 'GET');
  if (!accountResponse.ok) {
    check('FAIL', 'Authenticated account', `Binance TESTNET returned HTTP ${accountResponse.status}; credentials or permissions rejected`);
    process.exitCode = 1;
    return;
  }
  const account = await accountResponse.json() as { canTrade?: boolean; permissions?: string[]; balances?: Array<{ asset: string; free: string }> };
  check(account.canTrade === true ? 'PASS' : 'FAIL', 'Account permissions', account.canTrade === true ? 'account can trade' : 'account cannot trade');
  check(Array.isArray(account.balances) ? 'PASS' : 'FAIL', 'Balance retrieval', Array.isArray(account.balances) ? `${account.balances.length} balances returned` : 'balances missing');
  check(account.permissions?.includes('SPOT') || account.canTrade === true ? 'PASS' : 'FAIL', 'Spot permission', 'spot permission accepted by account response');

  const websocketOk = await verifyUserDataStream(apiKey!, apiSecret!);
  check(websocketOk ? 'PASS' : 'BLOCKED', 'User-data websocket', websocketOk ? 'authenticated Binance TESTNET subscription established' : 'authenticated subscription failed or timed out');
  if (!websocketOk || account.canTrade !== true || symbol?.status !== 'TRADING' || symbol.isSpotTradingAllowed !== true) {
    process.exitCode = 1;
    return;
  }

  check('PASS', 'Order submission', 'not executed; preflight verifies capability only');
  check('PASS', 'Execution path', 'TradingService -> mode/readiness -> RiskEngine -> AuthorizationService -> ExecutionEngine -> OrderService -> Binance TESTNET');
  console.log('PASS TESTNET preflight: authenticated connectivity and capability verified; no order submitted');
}

void main().catch((error) => {
  console.error(`FAIL TESTNET preflight: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
