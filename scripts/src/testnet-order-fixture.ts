import { createHmac } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { prisma } from '@rfsanz/database';
import { buildCanonicalClientOrderId } from '@rfsanz/exchange';
import { buildSignedRequestUrl, signedQuery } from './binance-signing.ts';
import { buildRiskValidLevels } from './testnet-order-fixture-logic.ts';

const root = resolve(import.meta.dirname, '../..');
const envPath = resolve(root, 'apps/api/.env.testnet');
const apiUrl = process.env.TESTNET_API_URL || 'http://127.0.0.1:3002';

function loadEnvironment(): Record<string, string> {
  if (!existsSync(envPath)) throw new Error('Missing dedicated TESTNET environment');
  const env: Record<string, string> = {};
  for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator > 0) env[trimmed.slice(0, separator)] = trimmed.slice(separator + 1).replace(/^['"]|['"]$/g, '');
  }
  const legacyKey = env.BINANCE_API_KEY;
  const legacySecret = env.BINANCE_API_SECRET;
  if (env.BINANCE_TESTNET_API_KEY && legacyKey && env.BINANCE_TESTNET_API_KEY !== legacyKey) {
    throw new Error('Blocked TESTNET environment: conflicting TESTNET API key variables');
  }
  if (env.BINANCE_TESTNET_API_SECRET && legacySecret && env.BINANCE_TESTNET_API_SECRET !== legacySecret) {
    throw new Error('Blocked TESTNET environment: conflicting TESTNET API secret variables');
  }
  if (!env.BINANCE_TESTNET_API_KEY && legacyKey) env.BINANCE_TESTNET_API_KEY = legacyKey;
  if (!env.BINANCE_TESTNET_API_SECRET && legacySecret) env.BINANCE_TESTNET_API_SECRET = legacySecret;
  return env;
}

function jwtToken(userId: string, secret: string): string {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const now = Math.floor(Date.now() / 1000);
  const payload = encode({ sub: userId, iat: now, exp: now + 900 });
  const input = `${header}.${payload}`;
  const signature = createHmac('sha256', secret).update(input).digest('base64url');
  return `${input}.${signature}`;
}

async function apiPost(path: string, token: string, body: unknown): Promise<{ status: number; data: any }> {
  const response = await fetch(`${apiUrl}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, data: JSON.parse(text) };
}

async function exchangeJson(path: string, apiKey: string, secret: string, params: Record<string, string | number> = {}): Promise<any> {
  const response = await fetch(buildSignedRequestUrl(path, secret, params), {
    headers: { 'X-MBX-APIKEY': apiKey },
  });
  const data: any = await response.json();
  if (!response.ok) throw new Error(`Binance ${path} failed with HTTP ${response.status} code=${String(data?.code ?? 'unknown')}`);
  return data;
}

async function main(): Promise<void> {
  const env = loadEnvironment();
  for (const [key, value] of Object.entries(env)) {
    if (key === 'DATABASE_URL' || key === 'REDIS_URL' || key === 'JWT_ACCESS_SECRET') {
      process.env[key] = value;
    }
  }
  if (env.TRADING_MODE !== 'TESTNET' || env.LIVE_TRADING_ENABLED !== 'false' || env.TESTNET_READY !== 'true') {
    throw new Error('TESTNET safety configuration is invalid');
  }
  if (!env.BINANCE_TESTNET_API_KEY || !env.BINANCE_TESTNET_API_SECRET || !env.JWT_ACCESS_SECRET || !env.EXCHANGE_CREDENTIAL_ENCRYPTION_KEY) {
    throw new Error('TESTNET credentials or JWT configuration is missing');
  }

  const infoResponse = await fetch('https://testnet.binance.vision/api/v3/exchangeInfo?symbol=BTCUSDT');
  const tickerResponse = await fetch('https://testnet.binance.vision/api/v3/ticker/bookTicker?symbol=BTCUSDT');
  const info: any = await infoResponse.json();
  const ticker: any = await tickerResponse.json();
  const symbol = info.symbols?.[0];
  const filters = Object.fromEntries((symbol?.filters || []).map((filter: any) => [filter.filterType, filter]));
  const ask = Number(ticker.askPrice);
  const minNotional = Number((filters.NOTIONAL || filters.MIN_NOTIONAL).minNotional);
  const step = Number(filters.LOT_SIZE.stepSize);
  const minQty = Number(filters.LOT_SIZE.minQty);
  const quantity = Number(Math.max(minQty, Math.ceil((minNotional / ask) / step) * step).toFixed(8));
  const price = Number(ask.toFixed(2));
  const levels = buildRiskValidLevels(price);

  // This signed request is the fixture's only account lookup and is verified by the focused test.
  const accountData = await exchangeJson('/v3/account', env.BINANCE_TESTNET_API_KEY, env.BINANCE_TESTNET_API_SECRET);
  const usdt = accountData.balances?.find((balance: any) => balance.asset === 'USDT');
  if (!usdt || Number(usdt.free) <= 0) throw new Error('TESTNET account has no free USDT balance');

  const user = await prisma.user.create({ data: { email: `testnet-order-${Date.now()}@local.invalid`, name: 'TESTNET controlled order' } });
  let cleanup = true;
  try {
    const account = await prisma.exchangeAccount.create({ data: { userId: user.id, exchange: 'binance', accountId: `testnet-${user.id}`, isActive: true } });
    const { CredentialCryptoService } = await import('@rfsanz/exchange');
    const cryptoService = new CredentialCryptoService(env.EXCHANGE_CREDENTIAL_ENCRYPTION_KEY);
    await prisma.apiKey.create({
      data: {
        userId: user.id,
        exchangeAccountId: account.id,
        keyHash: env.BINANCE_TESTNET_API_KEY,
        secretEncrypted: cryptoService.encrypt(env.BINANCE_TESTNET_API_SECRET),
        permissions: ['TRADE'],
        revoked: false,
      },
    });
    await prisma.balanceHistory.create({ data: { userId: user.id, exchange: 'binance', asset: 'USDT', free: usdt.free, locked: usdt.locked, total: Number(usdt.free) + Number(usdt.locked), timestamp: new Date() } });
    const alert = await prisma.alert.create({ data: { userId: user.id, symbol: 'BTCUSDT', webhookSource: 'controlled-testnet-order', status: 'RECOMMENDED' } });
    const consensus = await prisma.consensus.create({ data: { alertId: alert.id, symbol: 'BTCUSDT', recommendation: 'BUY', confidenceScore: 1, riskScore: 0, bulletPoints: ['controlled TESTNET verification'], analysis: 'Controlled TESTNET order verification', providerVotes: {} } });
    const recommendation = await prisma.recommendation.create({ data: { consensusId: consensus.id, alertId: alert.id, userId: user.id, symbol: 'BTCUSDT', recommendationType: 'BUY', entryPrice: price, targetPrice: levels.targetPrice, stopLoss: levels.stopLoss, riskReward: 2, positionSizePercentage: 0.1, urgency: 'IMMEDIATE', reasoning: 'Controlled TESTNET execution verification', status: 'PENDING' } });
    const token = jwtToken(user.id, env.JWT_ACCESS_SECRET);
    const create = await apiPost('/api/trading/orders/create', token, { recommendationId: recommendation.id, symbol: 'BTCUSDT', side: 'BUY', quantity, price, exchange: 'binance', stopLoss: levels.stopLoss, targetPrice: levels.targetPrice });
    const orderId = create.data?.data?.id || create.data?.id || create.data?.data?.data?.id;
    if (create.status !== 201 || !orderId) throw new Error(`Order creation failed with HTTP ${create.status}`);
    const clientOrderId = buildCanonicalClientOrderId(orderId);
    console.log(JSON.stringify({
      clientOrderId,
      clientOrderIdLength: clientOrderId.length,
      symbol: 'BTCUSDT',
      side: 'BUY',
      type: 'LIMIT',
      quantity,
      price,
      notional: Number((quantity * price).toFixed(8)),
      filters: {
        minQty: filters.LOT_SIZE.minQty,
        stepSize: filters.LOT_SIZE.stepSize,
        minNotional,
        tickSize: filters.PRICE_FILTER.tickSize,
      },
      hasClientOrderId: true,
    }));
    const submit = await apiPost(`/api/trading/orders/${orderId}/submit`, token, {});
    console.log(JSON.stringify({ symbol: 'BTCUSDT', filters: { minQty: filters.LOT_SIZE.minQty, stepSize: filters.LOT_SIZE.stepSize, minNotional }, quantity, price, stopLoss: levels.stopLoss, targetPrice: levels.targetPrice, orderId, submitStatus: submit.status, submitData: submit.data }));
    cleanup = false;
  } finally {
    if (cleanup) {
      const created = await prisma.order.findFirst({ where: { userId: user.id }, select: { id: true } });
      if (created) await prisma.orderAnalysisLink.deleteMany({ where: { orderId: created.id } });
      await prisma.order.deleteMany({ where: { userId: user.id } });
      await prisma.recommendation.deleteMany({ where: { userId: user.id } });
      await prisma.consensus.deleteMany({ where: { alert: { userId: user.id } } });
      await prisma.alert.deleteMany({ where: { userId: user.id } });
      await prisma.balanceHistory.deleteMany({ where: { userId: user.id } });
      await prisma.apiKey.deleteMany({ where: { userId: user.id } });
      await prisma.exchangeAccount.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } });
    }
  }
}

void main().catch(async (error) => {
  console.error(`CONTROLLED TESTNET ORDER FAILED: ${error instanceof Error ? error.message : String(error)}`);
  await prisma.$disconnect();
  process.exitCode = 1;
});
