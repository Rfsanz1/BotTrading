export type CanonicalRuntimeMode = 'TESTNET' | 'LIVE';

export type CanonicalExchangeAccount = {
  id: string;
  userId: string;
  exchange: string;
  accountId: string;
  isActive: boolean;
  apiKeys: Array<{
    id: string;
    userId: string;
    exchangeAccountId: string | null;
    keyHash: string;
    secretEncrypted: string;
    permissions: unknown;
    revoked: boolean;
  }>;
};

type DatabaseClient = {
  exchangeAccount: any;
};

function configurationName(mode: CanonicalRuntimeMode): string {
  return mode === 'TESTNET'
    ? 'TESTNET_EXCHANGE_ACCOUNT_ID'
    : 'LIVE_EXCHANGE_ACCOUNT_ID';
}

function expectedAccountPrefix(mode: CanonicalRuntimeMode): string {
  return `${mode.toLowerCase()}-`;
}

export async function resolveCanonicalExchangeAccount(
  db: DatabaseClient,
  mode: CanonicalRuntimeMode,
  configuredAccountId = process.env[configurationName(mode)],
): Promise<CanonicalExchangeAccount> {
  if (!configuredAccountId) {
    throw new Error(`${configurationName(mode)} is required for ${mode} runtime`);
  }

  const accounts = await db.exchangeAccount.findMany({
    where: {
      id: configuredAccountId,
      exchange: 'binance',
      isActive: true,
    },
    include: {
      apiKeys: {
        where: { revoked: false },
        orderBy: { createdAt: 'desc' },
      },
    },
  });

  if (accounts.length === 0) {
    throw new Error(`Configured ${mode} exchange account was not found or is inactive`);
  }
  if (accounts.length !== 1) {
    throw new Error(`Configured ${mode} exchange account is ambiguous`);
  }

  const account = accounts[0];
  if (account.id !== configuredAccountId) {
    throw new Error(`Configured ${mode} exchange account identity mismatch`);
  }
  if (!account.isActive) {
    throw new Error(`Configured ${mode} exchange account was not found or is inactive`);
  }
  if (account.exchange.toLowerCase() !== 'binance') {
    throw new Error(`${mode} runtime requires a Binance exchange account`);
  }
  if (!account.accountId.toLowerCase().startsWith(expectedAccountPrefix(mode))) {
    throw new Error(`Exchange account identity is not scoped to ${mode}`);
  }
  if (account.apiKeys.length !== 1) {
    throw new Error(`${mode} exchange account must have exactly one active credential`);
  }
  const permissions = new Set((account.apiKeys[0].permissions as string[]).map((permission) => permission.toUpperCase()));
  if (!permissions.has('TRADE')) {
    throw new Error(`${mode} exchange account credential must include TRADE permission`);
  }
  if (permissions.has('WITHDRAW') || permissions.has('TRANSFER')) {
    throw new Error(`${mode} exchange account credential must not include withdrawal or transfer permissions`);
  }
  if (
    account.apiKeys[0].exchangeAccountId !== account.id
    || account.apiKeys[0].userId !== account.userId
  ) {
    throw new Error(`${mode} credential does not belong to the resolved exchange account`);
  }

  return account;
}
