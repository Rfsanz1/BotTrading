import * as bcrypt from 'bcryptjs';
import {
  assertBreakGlassAuthorization,
  bootstrapInitialPassword,
  validateBootstrapPassword,
} from './password-bootstrap-operator';

describe('break-glass password bootstrap', () => {
  const targetUserId = 'target-user';

  function fakeDb(target: any = { id: targetUserId, isActive: true, password: null }) {
    const tx = {
      user: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
      session: { deleteMany: jest.fn().mockResolvedValue({ count: 1 }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-id' }) },
    };
    return {
      user: { findUnique: jest.fn().mockResolvedValue(target) },
      session: { deleteMany: jest.fn() },
      auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (callback: any) => callback(tx)),
      tx,
    } as any;
  }

  it('requires a strong matching password', () => {
    expect(() => validateBootstrapPassword('short', 'short')).toThrow('at least');
    expect(() => validateBootstrapPassword('long-enough-password', 'different-password')).toThrow('confirmation');
  });

  it('requires root and rejects detectable remote sessions', () => {
    expect(() => assertBreakGlassAuthorization(1000, {})).toThrow('root');
    expect(() => assertBreakGlassAuthorization(0, { SSH_CONNECTION: 'remote' })).toThrow('local');
    expect(() => assertBreakGlassAuthorization(0, {})).not.toThrow();
  });

  it('stores only a bcrypt hash, invalidates sessions, and audits without secrets', async () => {
    const db = fakeDb();
    const result = await bootstrapInitialPassword(db, targetUserId, 'long-enough-password', 'long-enough-password');
    const update = db.tx.user.updateMany.mock.calls[0][0];
    expect(result).toEqual({ targetUserId, sessionsInvalidated: 1 });
    expect(update.where).toEqual({ id: targetUserId, isActive: true, password: null });
    expect(update.data.password).not.toBe('long-enough-password');
    await expect(bcrypt.compare('long-enough-password', update.data.password)).resolves.toBe(true);
    expect(db.tx.session.deleteMany).toHaveBeenCalledWith({ where: { userId: targetUserId } });
    expect(db.tx.auditLog.create.mock.calls[0][0].data).toEqual(expect.objectContaining({
      action: 'USER_INITIAL_PASSWORD_BOOTSTRAP',
      resource: `user:${targetUserId}`,
    }));
    expect(JSON.stringify(db.tx.auditLog.create.mock.calls[0])).not.toContain('long-enough-password');
  });

  it('rejects existing passwords and inactive users without a transaction', async () => {
    await expect(bootstrapInitialPassword(fakeDb({ id: targetUserId, isActive: true, password: 'hash' }), targetUserId, 'long-enough-password', 'long-enough-password'))
      .rejects.toThrow('already has a password');
    await expect(bootstrapInitialPassword(fakeDb({ id: targetUserId, isActive: false, password: null }), targetUserId, 'long-enough-password', 'long-enough-password'))
      .rejects.toThrow('inactive');
  });

  it('does not change ownership or roles', async () => {
    const db = fakeDb({ id: targetUserId, isActive: true, password: null, userId: 'owner', roles: [{ role: { name: 'USER' } }] });
    await bootstrapInitialPassword(db, targetUserId, 'long-enough-password', 'long-enough-password');
    expect(db.tx.user.updateMany.mock.calls[0][0].data).toEqual({ password: expect.any(String) });
  });
});
