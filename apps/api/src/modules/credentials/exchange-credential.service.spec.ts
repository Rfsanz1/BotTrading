import crypto from 'node:crypto';
import { CredentialCryptoService } from '@rfsanz/exchange';
import { ExchangeCredentialService } from './exchange-credential.service';

type Row = Record<string, any>;

function makeDatabase() {
  const users = new Map<string, Row>();
  const accounts = new Map<string, Row>();
  const keys = new Map<string, Row>();
  const audits: Row[] = [];
  let sequence = 0;
  const db: any = {
    user: { findUnique: async ({ where }: any) => users.get(where.id) ?? null },
    exchangeAccount: { findUnique: async ({ where }: any) => accounts.get(where.id) ?? null },
    apiKey: {
      findFirst: async ({ where }: any) => [...keys.values()].find((row) =>
        row.exchangeAccountId === where.exchangeAccountId && row.revoked === where.revoked) ?? null,
      findUnique: async ({ where }: any) => keys.get(where.id) ?? null,
      create: async ({ data }: any) => {
        const row = { id: `key-${++sequence}`, ...data };
        keys.set(row.id, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = keys.get(where.id);
        if (!row) throw new Error('missing key');
        Object.assign(row, data);
        return row;
      },
    },
    auditLog: { create: async ({ data }: any) => audits.push(data) },
    $transaction: async (callback: (tx: any) => Promise<unknown>) => callback(db),
    seed: { users, accounts, keys, audits },
  };
  return db;
}

function request(overrides: Partial<any> = {}) {
  return {
    actorUserId: 'user-1',
    ownerUserId: 'user-1',
    exchangeAccountId: 'account-1',
    accountId: 'testnet-account-1',
    exchange: 'BINANCE' as const,
    mode: 'TESTNET' as const,
    apiKey: 'fresh-testnet-key',
    apiSecret: 'fresh-testnet-secret',
    permissions: ['TRADE'],
    ...overrides,
  };
}

describe('ExchangeCredentialService', () => {
  const key = crypto.randomBytes(32).toString('base64');
  let db: ReturnType<typeof makeDatabase>;
  let service: ExchangeCredentialService;

  beforeEach(() => {
    db = makeDatabase();
    db.seed.users.set('user-1', { id: 'user-1', isActive: true, roles: [{ role: { name: 'USER' } }] });
    db.seed.users.set('admin-1', { id: 'admin-1', isActive: true, roles: [{ role: { name: 'ADMIN' } }] });
    db.seed.users.set('user-2', { id: 'user-2', isActive: true, roles: [{ role: { name: 'USER' } }] });
    db.seed.accounts.set('account-1', {
      id: 'account-1',
      userId: 'user-1',
      exchange: 'binance',
      accountId: 'testnet-account-1',
      isActive: true,
    });
    service = new ExchangeCredentialService(db as any, () => new CredentialCryptoService(key));
  });

  it('creates encrypted TESTNET credentials without persisting or returning plaintext', async () => {
    const result = await service.createExchangeCredential(request());
    const stored = db.seed.keys.get(result.credentialId);
    expect(result).toEqual(expect.objectContaining({ mode: 'TESTNET', active: true }));
    expect(stored?.secretEncrypted).toMatch(/^v1:/);
    expect(stored?.secretEncrypted).not.toContain('fresh-testnet-secret');
    expect(JSON.stringify(result)).not.toContain('fresh-testnet-secret');
    expect(new CredentialCryptoService(key).decrypt(stored.secretEncrypted)).toBe('fresh-testnet-secret');
    expect(db.seed.audits[0].meta).not.toHaveProperty('apiSecret');
  });

  it('rejects duplicate active credentials and preserves old credentials during rotation', async () => {
    const first = await service.createExchangeCredential(request());
    await expect(service.createExchangeCredential(request())).rejects.toThrow('active credential');
    const rotated = await service.rotateExchangeCredential({
      ...request({ apiKey: 'replacement-key', apiSecret: 'replacement-secret' }),
      credentialId: first.credentialId,
    });
    expect(db.seed.keys.get(first.credentialId)?.revoked).toBe(true);
    expect(db.seed.keys.get(rotated.credentialId)?.revoked).toBe(false);
    expect(db.seed.keys.size).toBe(2);
  });

  it('updates permissions without changing the encrypted secret or account scope', async () => {
    const created = await service.createExchangeCredential(request());
    const before = db.seed.keys.get(created.credentialId).secretEncrypted;
    const updated = await service.updateExchangeCredential({
      actorUserId: 'user-1',
      ownerUserId: 'user-1',
      credentialId: created.credentialId,
      exchangeAccountId: 'account-1',
      accountId: 'testnet-account-1',
      exchange: 'BINANCE',
      mode: 'TESTNET',
      permissions: ['read', 'TRADE', 'read'],
    });
    expect(updated.credentialId).toBe(created.credentialId);
    expect(db.seed.keys.get(created.credentialId).secretEncrypted).toBe(before);
    expect(db.seed.keys.get(created.credentialId).permissions).toEqual(['READ', 'TRADE']);
    await expect(service.updateExchangeCredential({
      actorUserId: 'user-2',
      ownerUserId: 'user-1',
      credentialId: created.credentialId,
      exchangeAccountId: 'account-1',
      accountId: 'testnet-account-1',
      exchange: 'BINANCE',
      mode: 'TESTNET',
      permissions: ['READ'],
    })).rejects.toThrow('ownership');
  });

  it('rejects ownership, account, and mode mismatches', async () => {
    await expect(service.createExchangeCredential(request({ actorUserId: 'user-2' }))).rejects.toThrow('ownership');
    await expect(service.createExchangeCredential(request({ accountId: 'live-account-1' }))).rejects.toThrow('identity');
    await expect(service.createExchangeCredential(request({ mode: 'LIVE' }))).rejects.toThrow('scoped to LIVE');
    await expect(service.createExchangeCredential(request({ exchange: 'COINBASE' as any }))).rejects.toThrow('Unsupported exchange');
  });

  it('allows an admin to manage an owned account without changing account scope', async () => {
    const result = await service.createExchangeCredential(request({ actorUserId: 'admin-1' }));
    expect(result.exchangeAccountId).toBe('account-1');
    expect(result.accountId).toBe('testnet-account-1');
  });

  it('fails closed for missing or invalid encryption keys', async () => {
    const missing = new ExchangeCredentialService(db as any, () => new CredentialCryptoService(''));
    await expect(missing.createExchangeCredential(request())).rejects.toThrow('required');
    const invalid = new ExchangeCredentialService(db as any, () => new CredentialCryptoService('too-short'));
    await expect(invalid.createExchangeCredential(request())).rejects.toThrow('exactly 32 bytes');
  });

  it('fails closed when a different encryption key is used for decryption', async () => {
    const result = await service.createExchangeCredential(request());
    const stored = db.seed.keys.get(result.credentialId);
    expect(() => new CredentialCryptoService(crypto.randomBytes(32).toString('base64')).decrypt(stored.secretEncrypted))
      .toThrow('authentication failed');
  });

  it('does not include secrets in validation errors or audit records', async () => {
    const secret = 'secret-that-must-not-leak';
    await expect(service.createExchangeCredential(request({ apiSecret: `${secret}\n` })))
      .rejects.toThrow('invalid');
    expect(JSON.stringify(db.seed.audits)).not.toContain(secret);
  });
});
