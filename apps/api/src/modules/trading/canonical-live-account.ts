import prisma, {
  CanonicalExchangeAccount,
  resolveCanonicalExchangeAccount,
} from '@rfsanz/database';
import { CredentialCryptoService, ExchangeAccount } from '@rfsanz/exchange';

export async function resolveCanonicalLiveAccount(
  expectedUserId?: string,
): Promise<ExchangeAccount & { exchangeAccountId: string }> {
  const databaseAccount: CanonicalExchangeAccount = await resolveCanonicalExchangeAccount(prisma, 'LIVE');
  if (expectedUserId && databaseAccount.userId !== expectedUserId) {
    throw new Error('LIVE order user is not the configured canonical account owner');
  }

  const credential = databaseAccount.apiKeys[0];
  const crypto = new CredentialCryptoService();
  return {
    id: databaseAccount.id,
    exchangeAccountId: databaseAccount.id,
    userId: databaseAccount.userId,
    exchange: 'binance',
    accountId: databaseAccount.accountId,
    credentials: {
      apiKey: credential.keyEncrypted ? crypto.decrypt(credential.keyEncrypted) : credential.keyHash,
      apiSecret: crypto.decrypt(credential.secretEncrypted),
    },
    isActive: databaseAccount.isActive,
    isPaper: false,
    tradingMode: 'LIVE',
  };
}
