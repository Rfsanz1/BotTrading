import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import prisma from '@rfsanz/database';
import * as bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;

const MIN_PASSWORD_LENGTH = 12;

type PasswordResetDb = {
  user: {
    findUnique: (args: any) => Promise<any>;
    update: (args: any) => Promise<any>;
  };
  session: { deleteMany: (args: any) => Promise<any> };
  auditLog: { create: (args: any) => Promise<any> };
  $transaction: <T>(callback: (tx: PasswordResetDb) => Promise<T>) => Promise<T>;
};

export function validateNewPassword(password: string, confirmation: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password !== confirmation) throw new Error('Password confirmation does not match');
}

export async function resetUserPassword(
  db: PasswordResetDb,
  actorUserId: string,
  targetUserId: string,
  password: string,
  confirmation: string,
): Promise<{ actorUserId: string; targetUserId: string; sessionsInvalidated: number }> {
  validateNewPassword(password, confirmation);
  const actor = await db.user.findUnique({
    where: { id: actorUserId },
    select: { id: true, isActive: true, roles: { select: { role: { select: { name: true } } } } },
  });
  if (!actor?.isActive || !actor.roles.some(({ role }: any) => role.name === 'ADMIN')) {
    throw new Error('An active ADMIN actor is required');
  }
  const target = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, isActive: true },
  });
  if (!target) throw new Error('Target user was not found');
  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  return db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: targetUserId }, data: { password: passwordHash } });
    const sessions = await tx.session.deleteMany({ where: { userId: targetUserId } });
    await tx.auditLog.create({
      data: {
        userId: actorUserId,
        action: 'USER_PASSWORD_RESET',
        resource: `user:${targetUserId}`,
        meta: { targetUserId, sessionsInvalidated: sessions.count },
      },
    });
    return { actorUserId, targetUserId, sessionsInvalidated: sessions.count };
  });
}

async function promptHidden(question: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) throw new Error('Hidden password input requires an interactive terminal');
  return new Promise((resolve, reject) => {
    let answer = '';
    const onData = (chunk: Buffer) => {
      const value = chunk.toString();
      if (value === '\n' || value === '\r' || value === '\u0004') {
        input.setRawMode?.(false);
        input.pause();
        input.removeListener('data', onData);
        output.write('\n');
        if (value === '\u0004') reject(new Error('Password input cancelled'));
        else resolve(answer);
        return;
      }
      if (value === '\u007f') answer = answer.slice(0, -1);
      else answer += value;
    };
    output.write(question);
    input.resume();
    input.setRawMode?.(true);
    input.on('data', onData);
  });
}

async function promptVisible(question: string): Promise<string> {
  const reader = createInterface({ input, output });
  try {
    return (await reader.question(question)).trim();
  } finally {
    reader.close();
  }
}

export async function runPasswordResetOperator(
  db: PasswordResetDb = prisma as unknown as PasswordResetDb,
): Promise<{ actorUserId: string; targetUserId: string; sessionsInvalidated: number }> {
  const actorUserId = await promptVisible('Active ADMIN actor user ID: ');
  const targetUserId = await promptVisible('Target user ID: ');
  const password = await promptHidden('New password (hidden): ');
  const confirmation = await promptHidden('Confirm new password (hidden): ');
  return resetUserPassword(db, actorUserId, targetUserId, password, confirmation);
}
