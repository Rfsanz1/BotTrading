import prisma from '@rfsanz/database';
import { runPasswordResetOperator } from './password-reset-operator';

runPasswordResetOperator()
  .then(({ actorUserId, targetUserId, sessionsInvalidated }) => {
    console.log(JSON.stringify({ actorUserId, targetUserId, sessionsInvalidated }));
  })
  .catch((error) => {
    console.error(`Password reset failed: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
