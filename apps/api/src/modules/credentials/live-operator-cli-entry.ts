import prisma from '@rfsanz/database';
import { runLiveCredentialOperator } from './operator-cli';

runLiveCredentialOperator()
  .then((result) => console.log(JSON.stringify({
    credentialId: result.credentialId,
    exchangeAccountId: result.exchangeAccountId,
    accountId: result.accountId,
    exchange: result.exchange,
    mode: result.mode,
    active: result.active,
  })))
  .catch((error) => {
    console.error(`LIVE credential operation blocked: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  })
  .finally(async () => { await prisma.$disconnect(); });
