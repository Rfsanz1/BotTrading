import prisma, {
  CanonicalExchangeAccount,
  resolveCanonicalExchangeAccount,
} from '@rfsanz/database';
import { CredentialCryptoService, ExchangeAccount } from '@rfsanz/exchange';

export async function resolveCanonicalTestnetAccount(
  expectedUserId?: string,
): Promise<ExchangeAccount & { exchangeAccountId: string }> {
  const databaseAccount: CanonicalExchangeAccount = await resolveCanonicalExchangeAccount(prisma, 'TESTNET');
  if (expectedUserId && databaseAccount.userId !== expectedUserId) {
    throw new Error('TESTNET order user is not the configured canonical account owner');
  }

  const credential = databaseAccount.apiKeys[0];
  const crypto = new CredentialCryptoService();
  const credentials = {
    apiKey: credential.keyHash,
    apiSecret: crypto.decrypt(credential.secretEncrypted),
  };

  return {
    id: databaseAccount.id,
    exchangeAccountId: databaseAccount.id,
    userId: databaseAccount.userId,
    exchange: 'binance',
    accountId: databaseAccount.accountId,
    credentials,
    isActive: databaseAccount.isActive,
    isPaper: false,
    tradingMode: 'TESTNET',
  };
}
