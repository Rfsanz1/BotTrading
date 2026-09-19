import { resolveCanonicalExchangeAccount } from '@rfsanz/database';

function account(overrides: Record<string, unknown> = {}) {
  return {
    id: 'account-db-id',
    userId: 'owner-id',
    exchange: 'binance',
    accountId: 'testnet-owner-id',
    isActive: true,
    apiKeys: [{
      id: 'credential-id',
      userId: 'owner-id',
      exchangeAccountId: 'account-db-id',
      keyHash: 'public-key-hash',
      secretEncrypted: 'v1:opaque',
      permissions: ['TRADE'],
      revoked: false,
    }],
    ...overrides,
  };
}

function fakeDb(rows: any[]) {
  return {
    exchangeAccount: {
      findMany: jest.fn().mockResolvedValue(rows),
    },
  };
}

describe('canonical TESTNET exchange account resolution', () => {
  it('resolves the explicitly configured account and its sole credential', async () => {
    const db = fakeDb([account()]);
    await expect(resolveCanonicalExchangeAccount(db, 'TESTNET', 'account-db-id'))
      .resolves.toMatchObject({ id: 'account-db-id', accountId: 'testnet-owner-id' });
    expect(db.exchangeAccount.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'account-db-id', exchange: 'binance', isActive: true },
    }));
  });

  it('fails closed when configuration is missing or ambiguous', async () => {
    await expect(resolveCanonicalExchangeAccount(fakeDb([account()]), 'TESTNET', ''))
      .rejects.toThrow('TESTNET_EXCHANGE_ACCOUNT_ID is required');
    await expect(resolveCanonicalExchangeAccount(fakeDb([account(), account({ id: 'duplicate' })]), 'TESTNET', 'account-db-id'))
      .rejects.toThrow('ambiguous');
  });

  it('rejects inactive, wrong-mode, and live identity accounts', async () => {
    await expect(resolveCanonicalExchangeAccount(fakeDb([]), 'TESTNET', 'account-db-id'))
      .rejects.toThrow('not found or is inactive');
    await expect(resolveCanonicalExchangeAccount(fakeDb([account({ isActive: false })]), 'TESTNET', 'account-db-id'))
      .rejects.toThrow('not found or is inactive');
    await expect(resolveCanonicalExchangeAccount(fakeDb([account({ accountId: 'live-owner-id' })]), 'TESTNET', 'account-db-id'))
      .rejects.toThrow('not scoped to TESTNET');
  });

  it('rejects credential ownership, attachment, and cardinality violations', async () => {
    await expect(resolveCanonicalExchangeAccount(fakeDb([account({
      apiKeys: [{ ...account().apiKeys[0], userId: 'other-owner' }],
    })]), 'TESTNET', 'account-db-id')).rejects.toThrow('does not belong');
    await expect(resolveCanonicalExchangeAccount(fakeDb([account({
      apiKeys: [{ ...account().apiKeys[0], exchangeAccountId: 'other-account' }],
    })]), 'TESTNET', 'account-db-id')).rejects.toThrow('does not belong');
    await expect(resolveCanonicalExchangeAccount(fakeDb([account({ apiKeys: [] })]), 'TESTNET', 'account-db-id'))
      .rejects.toThrow('exactly one active credential');
  });

  it('rejects a TESTNET account when resolving LIVE mode', async () => {
    await expect(resolveCanonicalExchangeAccount(fakeDb([account()]), 'LIVE', 'account-db-id'))
      .rejects.toThrow('not scoped to LIVE');
  });

  it('accepts a canonical LIVE account and rejects synthetic or mismatched identities', async () => {
    const live = account({ accountId: 'live-owner-id' });
    await expect(resolveCanonicalExchangeAccount(fakeDb([live]), 'LIVE', 'account-db-id'))
      .resolves.toMatchObject({ id: 'account-db-id', accountId: 'live-owner-id' });
    await expect(resolveCanonicalExchangeAccount(fakeDb([account({ accountId: 'startup-account' })]), 'LIVE', 'account-db-id'))
      .rejects.toThrow('not scoped to LIVE');
    await expect(resolveCanonicalExchangeAccount(fakeDb([live]), 'LIVE', 'different-account-id'))
      .rejects.toThrow('identity mismatch');
  });
});
