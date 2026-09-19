import {
  armLiveApproval,
  assertLiveApproval,
  getLiveApproval,
  revokeLiveApproval,
} from '../services/live-approval.service';

describe('LIVE operator approval', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv, TRADING_MODE: 'TESTNET', LIVE_TRADING_ENABLED: 'false' };
    revokeLiveApproval();
  });

  afterAll(() => {
    process.env = originalEnv;
    revokeLiveApproval();
  });

  it('fails closed without explicit LIVE runtime enablement', () => {
    expect(() => armLiveApproval({
      operatorUserId: 'operator',
      accountId: 'live-account',
      riskConfigVersion: 'risk-v1',
    })).toThrow(/explicit LIVE runtime enablement/);
    expect(getLiveApproval()).toBeUndefined();
  });

  it('binds approval to operator, account, mode, and risk version with TTL', () => {
    process.env.TRADING_MODE = 'LIVE';
    process.env.LIVE_TRADING_ENABLED = 'true';
    const approval = armLiveApproval({
      operatorUserId: 'operator',
      accountId: 'live-account',
      riskConfigVersion: 'risk-v2',
      ttlMs: 1000,
      now: 10_000,
    });
    expect(approval.mode).toBe('LIVE');
    expect(assertLiveApproval({ accountId: 'live-account', riskConfigVersion: 'risk-v2', now: 10_500 })).toBe(approval);
    expect(() => assertLiveApproval({ accountId: 'other', riskConfigVersion: 'risk-v2', now: 10_500 })).toThrow(/account mismatch/);
    expect(() => assertLiveApproval({ accountId: 'live-account', riskConfigVersion: 'risk-v1', now: 10_500 })).toThrow(/risk version mismatch/);
    expect(() => assertLiveApproval({ accountId: 'live-account', riskConfigVersion: 'risk-v2', now: 11_000 })).toThrow(/expired/);
  });

  it('supports immediate revoke and rejects stale approval', () => {
    process.env.TRADING_MODE = 'LIVE';
    process.env.LIVE_TRADING_ENABLED = 'true';
    armLiveApproval({ operatorUserId: 'operator', accountId: 'live-account', riskConfigVersion: 'risk-v1' });
    revokeLiveApproval();
    expect(() => assertLiveApproval({ accountId: 'live-account', riskConfigVersion: 'risk-v1' })).toThrow(/missing/);
  });
});
