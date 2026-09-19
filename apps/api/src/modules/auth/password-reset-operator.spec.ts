import * as bcrypt from 'bcryptjs';
import { resetUserPassword, validateNewPassword } from './password-reset-operator';

describe('password reset operator', () => {
  const targetUserId = 'target-user';
  const actorUserId = 'admin-user';

  function fakeDb(overrides: Record<string, any> = {}) {
    const tx = {
      user: { update: jest.fn().mockResolvedValue({ id: targetUserId }) },
      session: { deleteMany: jest.fn().mockResolvedValue({ count: 2 }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-id' }) },
    };
    return {
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({
            id: actorUserId,
            isActive: true,
            roles: [{ role: { name: 'ADMIN' } }],
          })
          .mockResolvedValueOnce({ id: targetUserId, isActive: true }),
      },
      session: { deleteMany: jest.fn() },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
      tx,
      ...overrides,
    } as any;
  }

  it('requires a strong matching password', () => {
    expect(() => validateNewPassword('short', 'short')).toThrow('at least');
    expect(() => validateNewPassword('long-enough-password', 'different-password')).toThrow('confirmation');
  });

  it('allows an active ADMIN to reset without persisting plaintext or changing ownership', async () => {
    const db = fakeDb();
    const result = await resetUserPassword(db, actorUserId, targetUserId, 'long-enough-password', 'long-enough-password');

    expect(result).toEqual({ actorUserId, targetUserId, sessionsInvalidated: 2 });
    const update = db.tx.user.update.mock.calls[0][0];
    expect(update.where).toEqual({ id: targetUserId });
    expect(update.data.password).not.toBe('long-enough-password');
    await expect(bcrypt.compare('long-enough-password', update.data.password)).resolves.toBe(true);
    expect(db.tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: targetUserId } });
    expect(db.tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        userId: actorUserId,
        action: 'USER_PASSWORD_RESET',
        resource: `user:${targetUserId}`,
      }),
    }));
    expect(JSON.stringify(db.tx.auditLog.create.mock.calls[0])).not.toContain('long-enough-password');
  });

  it('rejects non-admin actors before changing the target', async () => {
    const db = fakeDb({
      user: {
        findUnique: jest.fn()
          .mockResolvedValueOnce({ id: actorUserId, isActive: true, roles: [] })
          .mockResolvedValueOnce({ id: targetUserId, isActive: true }),
      },
    });
    await expect(resetUserPassword(db, actorUserId, targetUserId, 'long-enough-password', 'long-enough-password'))
      .rejects.toThrow('active ADMIN');
    expect(db.$transaction).not.toHaveBeenCalled();
  });

  it('does not alter the target ownership or roles', async () => {
    const db = fakeDb();
    await resetUserPassword(db, actorUserId, targetUserId, 'long-enough-password', 'long-enough-password');
    expect(db.tx.user.update.mock.calls[0][0].data).toEqual({ password: expect.any(String) });
  });
});
