import prisma from '@rfsanz/database';
import { runPasswordBootstrapOperator } from './password-bootstrap-operator';

runPasswordBootstrapOperator()
  .then(({ targetUserId, sessionsInvalidated }) => {
    console.log(JSON.stringify({ targetUserId, sessionsInvalidated }));
  })
  .catch((error) => {
    console.error(`Password bootstrap failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
