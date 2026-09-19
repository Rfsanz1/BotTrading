import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import prisma from '@rfsanz/database';
import * as bcrypt from 'bcryptjs';

const SALT_ROUNDS = 10;
const MIN_PASSWORD_LENGTH = 12;
const REMOTE_ENVIRONMENT_KEYS = ['SSH_CONNECTION', 'SSH_CLIENT', 'SSH_TTY'];

type BootstrapDb = {
  user: {
    findUnique: (args: any) => Promise<any>;
    updateMany: (args: any) => Promise<{ count: number }>;
  };
  session: { deleteMany: (args: any) => Promise<{ count: number }> };
  auditLog: { create: (args: any) => Promise<any> };
  $transaction: <T>(callback: (tx: BootstrapDb) => Promise<T>) => Promise<T>;
};

export function assertBreakGlassAuthorization(
  effectiveUid: number | undefined,
  environment: Record<string, string | undefined> = process.env,
): void {
  if (effectiveUid !== 0) throw new Error('Break-glass bootstrap requires root execution');
  if (REMOTE_ENVIRONMENT_KEYS.some((key) => environment[key])) {
    throw new Error('Break-glass bootstrap requires a local session');
  }
}

export function validateBootstrapPassword(password: string, confirmation: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }
  if (password !== confirmation) throw new Error('Password confirmation does not match');
}

export async function bootstrapInitialPassword(
  db: BootstrapDb,
  targetUserId: string,
  password: string,
  confirmation: string,
): Promise<{ targetUserId: string; sessionsInvalidated: number }> {
  validateBootstrapPassword(password, confirmation);
  const target = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, isActive: true, password: true },
  });
  if (!target) throw new Error('Target user was not found');
  if (!target.isActive) throw new Error('Target user is inactive');
  if (target.password) throw new Error('User already has a password; use the normal password-reset flow.');

  const passwordHash = await bcrypt.hash(password, SALT_ROUNDS);
  return db.$transaction(async (tx) => {
    const update = await tx.user.updateMany({
      where: { id: targetUserId, isActive: true, password: null },
      data: { password: passwordHash },
    });
    if (update.count !== 1) {
      throw new Error('User already has a password or is no longer eligible for bootstrap');
    }
    const sessions = await tx.session.deleteMany({ where: { userId: targetUserId } });
    await tx.auditLog.create({
      data: {
        action: 'USER_INITIAL_PASSWORD_BOOTSTRAP',
        resource: `user:${targetUserId}`,
        meta: { targetUserId, sessionsInvalidated: sessions.count },
      },
    });
    return { targetUserId, sessionsInvalidated: sessions.count };
  });
}

async function promptHidden(question: string): Promise<string> {
  if (!input.isTTY || !output.isTTY) {
    throw new Error('Hidden password input requires an interactive terminal');
  }
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

export async function runPasswordBootstrapOperator(
  db: BootstrapDb = prisma as unknown as BootstrapDb,
): Promise<{ targetUserId: string; sessionsInvalidated: number }> {
  assertBreakGlassAuthorization(process.getuid?.());
  const targetUserId = await promptVisible('Target user ID: ');
  const target = await db.user.findUnique({
    where: { id: targetUserId },
    select: { id: true, isActive: true, password: true, roles: { select: { role: { select: { name: true } } } } },
  });
  if (!target) throw new Error('Target user was not found');
  console.log(JSON.stringify({
    userId: target.id,
    active: target.isActive,
    hasPassword: Boolean(target.password) ? 'YES' : 'NO',
    roles: target.roles.map(({ role }: any) => role.name),
  }));
  if (!target.isActive) throw new Error('Target user is inactive');
  if (target.password) throw new Error('User already has a password; use the normal password-reset flow.');
  const password = await promptHidden('New password (hidden): ');
  const confirmation = await promptHidden('Confirm new password (hidden): ');
  return bootstrapInitialPassword(db, targetUserId, password, confirmation);
}
