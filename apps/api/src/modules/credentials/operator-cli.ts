import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import prisma from '@rfsanz/database';
import { BinanceAdapter, CredentialCryptoService } from '@rfsanz/exchange';
import {
  ExchangeCredentialService,
  type CredentialOperationResult,
  type ExchangeCredentialInput,
} from './exchange-credential.service';

export function validateTestnetOperatorScope(values: { mode: string; exchange: string; accountId: string }): void {
  if (values.mode !== 'TESTNET') throw new Error('Only TESTNET mode is supported');
  if (values.exchange !== 'BINANCE') throw new Error('Only BINANCE is supported');
  if (!/^testnet-[^/\\\s]+$/i.test(values.accountId)) throw new Error('Exchange account ID must start with testnet-');
}

export function validateLiveOperatorScope(values: { mode: string; exchange: string; accountId: string }): void {
  if (values.mode !== 'LIVE') throw new Error('Only LIVE mode is supported');
  if (values.exchange !== 'BINANCE') throw new Error('Only BINANCE is supported');
  if (!/^live-[^/\\\s]+$/i.test(values.accountId)) throw new Error('Exchange account ID must start with live-');
}

async function promptHidden(question: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) throw new Error('Hidden credential input requires an interactive terminal');
  return new Promise((resolve, reject) => {
    output.write(question);
    let answer = '';
    const onData = (chunk: Buffer) => {
      const value = chunk.toString();
      if (value === '\n' || value === '\r' || value === '\u0004') {
        input.setRawMode?.(false);
        input.pause();
        input.removeListener('data', onData);
        output.write('\n');
        if (value === '\u0004') reject(new Error('Credential input cancelled'));
        else resolve(answer);
        return;
      }
      if (value === '\u007f') answer = answer.slice(0, -1);
      else answer += value;
    };
    input.resume();
    input.setRawMode?.(true);
    input.on('data', onData);
  });
}

async function promptVisible(question: string): Promise<string> {
  const reader = createInterface({ input, output });
  try { return (await reader.question(question)).trim(); } finally { reader.close(); }
}

function requireEncryptionKey(): void {
  const value = process.env.EXCHANGE_CREDENTIAL_ENCRYPTION_KEY;
  if (!value) throw new Error('EXCHANGE_CREDENTIAL_ENCRYPTION_KEY is required in the process environment');
  new CredentialCryptoService(value);
}

async function findActiveCredentialIds(exchangeAccountId: string): Promise<string[]> {
  const rows = await prisma.apiKey.findMany({ where: { exchangeAccountId, revoked: false }, select: { id: true } });
  return rows.map(({ id }) => id);
}

async function collectTestnetInput(): Promise<ExchangeCredentialInput & { credentialId?: string }> {
  const actorUserId = await promptVisible('Actor user ID: ');
  const ownerUserId = await promptVisible('Owner/user ID: ');
  const exchangeAccountId = await promptVisible('TESTNET exchange account ID: ');
  const accountId = await promptVisible('External account ID (testnet-*): ');
  validateTestnetOperatorScope({ mode: 'TESTNET', exchange: 'BINANCE', accountId });
  const activeCredentialIds = await findActiveCredentialIds(exchangeAccountId);
  if (activeCredentialIds.length > 1) throw new Error('Multiple active credentials found; resolve account state before rotation');
  const credentialId = activeCredentialIds.length === 1
    ? await promptVisible(`Active credential ID (must match ${activeCredentialIds[0]}): `)
    : undefined;
  if (activeCredentialIds.length === 1 && credentialId !== activeCredentialIds[0]) throw new Error('Credential ID does not match active TESTNET credential');
  const apiKey = await promptHidden('Fresh Binance TESTNET API key (hidden): ');
  const apiSecret = await promptHidden('Fresh Binance TESTNET API secret (hidden): ');
  if (!apiKey || !apiSecret) throw new Error('Fresh TESTNET API key and secret are required');
  return { actorUserId, ownerUserId, exchangeAccountId, accountId, exchange: 'BINANCE', mode: 'TESTNET', apiKey, apiSecret, permissions: ['TRADE'], ...(credentialId ? { credentialId } : {}) };
}

export async function runTestnetCredentialOperator(service = new ExchangeCredentialService()): Promise<CredentialOperationResult> {
  requireEncryptionKey();
  const values = await collectTestnetInput();
  return values.credentialId
    ? service.rotateExchangeCredential({ ...values, credentialId: values.credentialId })
    : service.createExchangeCredential(values);
}

export async function runLiveCredentialOperator(service = new ExchangeCredentialService()): Promise<CredentialOperationResult> {
  requireEncryptionKey();
  const actorUserId = await promptVisible('Actor user ID: ');
  const ownerUserId = await promptVisible('Owner/user ID: ');
  const exchangeAccountId = await promptVisible('LIVE exchange account ID: ');
  const accountId = await promptVisible('External account ID (live-*): ');
  validateLiveOperatorScope({ mode: 'LIVE', exchange: 'BINANCE', accountId });
  const apiKey = await promptHidden('Fresh Binance LIVE API key (hidden): ');
  const apiSecret = await promptHidden('Fresh Binance LIVE API secret (hidden): ');
  if (await promptVisible('Type CREATE LIVE to continue: ') !== 'CREATE LIVE') throw new Error('LIVE credential creation was not manually confirmed');
  const account = { id: exchangeAccountId, userId: ownerUserId, exchange: 'binance', accountId, isActive: true, isPaper: false, tradingMode: 'LIVE' as const, credentials: { apiKey, apiSecret } };
  const adapter = new BinanceAdapter(account);
  await adapter.connect(account);
  const restrictions = await adapter.fetchApiRestrictions();
  await adapter.disconnect();
  if (restrictions.enableWithdrawals || !restrictions.ipRestrict) throw new Error('LIVE credential rejected: withdrawals must be disabled and IP restriction enabled');
  return service.createExchangeCredential({ actorUserId, ownerUserId, exchangeAccountId, accountId, exchange: 'BINANCE', mode: 'LIVE', apiKey, apiSecret, permissions: ['TRADE'] });
}
