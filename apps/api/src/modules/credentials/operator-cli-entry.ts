import prisma from '@rfsanz/database';
import { runTestnetCredentialOperator } from './operator-cli';

runTestnetCredentialOperator()
  .then((result) => {
    console.log(JSON.stringify({
      credentialId: result.credentialId,
      exchangeAccountId: result.exchangeAccountId,
      accountId: result.accountId,
      exchange: result.exchange,
      mode: result.mode,
      active: result.active,
      rotatedCredentialId: result.revokedCredentialId ?? null,
    }));
  })
  .catch((error) => {
    console.error(`TESTNET credential operation failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
