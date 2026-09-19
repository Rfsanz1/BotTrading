import { AuditController } from './audit.controller';

describe('AuditController authorization boundaries', () => {
  it('does not let a caller impersonate another user in a write payload', async () => {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const controller = new AuditController(audit as any);
    const request = { user: { id: 'user-a' }, ip: '127.0.0.1' };

    await expect(controller.log({
      userId: 'user-b',
      action: 'TEST',
      resource: 'test',
    }, request)).rejects.toThrow();
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('requires an authenticated owner or admin for user audit scope', async () => {
    const audit = { log: jest.fn().mockResolvedValue(undefined) };
    const controller = new AuditController(audit as any);
    await expect(controller.log({
      userId: 'user-a',
      action: 'TEST',
      resource: 'test',
    }, { ip: '127.0.0.1' })).rejects.toThrow(/Authentication is required/);
  });

  it('requires administrator scope for action-wide audit reads', async () => {
    const audit = { getLogsByAction: jest.fn() };
    const controller = new AuditController(audit as any);
    await expect(controller.getLogsByAction('LIVE_APPROVAL_ARMED', {
      user: { id: 'user-a' },
    })).rejects.toThrow();
    expect(audit.getLogsByAction).not.toHaveBeenCalled();
  });
});
