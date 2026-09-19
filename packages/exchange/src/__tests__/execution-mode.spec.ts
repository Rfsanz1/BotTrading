import {
  assertExecutionAllowed,
  resolveExecutionCapability,
} from '../services/execution-mode.service';
import { createExchange } from '../factory';
import { SystemReadinessService } from '../services/system-readiness.service';
import { armLiveApproval, revokeLiveApproval } from '../services/live-approval.service';

describe('canonical execution mode gate', () => {
  const readiness = SystemReadinessService.getInstance();
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    revokeLiveApproval();
  });

  function markReady(mode: 'TESTNET' | 'LIVE') {
    readiness.setPhase('SYSTEM_READY', 'test-ready');
    for (const key of [
      'DATABASE_READY',
      'CONFIG_VALID',
      'ACCOUNT_SYNC_READY',
      'ORDER_SYNC_READY',
      'POSITION_SYNC_READY',
      'EVENT_ROUTER_READY',
      'WEBSOCKET_READY',
      'RECONCILIATION_READY',
      'RISK_READY',
      'AI_READY',
      'LEARNING_READY',
      'STARTUP_GATE_READY',
      `${mode}_READY`,
    ] as const) {
      readiness.setCheck(key, true);
    }
  }

  it('permits PAPER only with the paper adapter', () => {
    process.env.TRADING_MODE = 'PAPER';
    process.env.LIVE_TRADING_ENABLED = 'false';
    expect(resolveExecutionCapability('paper').mode).toBe('PAPER');
    expect(() => resolveExecutionCapability('binance')).toThrow(/PAPER mode/);
  });

  it.each([false, true])('PAPER rejects Binance regardless of BINANCE_USE_TESTNET=%s', (useTestnet) => {
    process.env.TRADING_MODE = 'PAPER';
    process.env.LIVE_TRADING_ENABLED = 'false';
    process.env.BINANCE_USE_TESTNET = String(useTestnet);
    expect(() => createExchange('binance', {
      id: 'a', userId: 'u', exchange: 'binance', isActive: true, tradingMode: 'PAPER',
    })).toThrow(/PAPER mode/);
    expect(createExchange('paper', {
      id: 'a', userId: 'u', exchange: 'paper', isActive: true, isPaper: true, tradingMode: 'PAPER',
    })).toBeDefined();
  });

  it.each([false, true])('TESTNET selects testnet regardless of BINANCE_USE_TESTNET=%s', (useTestnet) => {
    process.env.TRADING_MODE = 'TESTNET';
    process.env.LIVE_TRADING_ENABLED = 'false';
    process.env.BINANCE_USE_TESTNET = String(useTestnet);
    const adapter = createExchange('binance', {
      id: 'a', userId: 'u', exchange: 'binance', isActive: true, isPaper: false, tradingMode: 'TESTNET',
    });
    expect((adapter as any).baseUrl).toContain('testnet');
  });

  it('does not let BINANCE_USE_TESTNET override TESTNET mode', () => {
    process.env.TRADING_MODE = 'TESTNET';
    process.env.LIVE_TRADING_ENABLED = 'false';
    process.env.BINANCE_USE_TESTNET = 'false';
    expect(resolveExecutionCapability('binance').mode).toBe('TESTNET');
  });

  it('blocks LIVE unless the explicit enable flag is true', () => {
    process.env.TRADING_MODE = 'LIVE';
    process.env.LIVE_TRADING_ENABLED = 'false';
    expect(() => resolveExecutionCapability('binance')).toThrow(/LIVE_TRADING_ENABLED=true/);
  });

  it.each([false, true])('LIVE selects production only from TRADING_MODE, not BINANCE_USE_TESTNET=%s', (useTestnet) => {
    process.env.TRADING_MODE = 'LIVE';
    process.env.LIVE_TRADING_ENABLED = 'true';
    process.env.BINANCE_USE_TESTNET = String(useTestnet);
    const adapter = createExchange('binance', {
      id: 'a', userId: 'u', exchange: 'binance', isActive: true, isPaper: false, tradingMode: 'LIVE',
    });
    expect((adapter as any).baseUrl).toContain('api.binance.com');
  });

  it('fails closed for invalid mode and account mismatch', () => {
    process.env.TRADING_MODE = 'INVALID';
    expect(() => resolveExecutionCapability('binance')).toThrow(/Unsupported TRADING_MODE/);
    process.env.TRADING_MODE = 'TESTNET';
    expect(() => createExchange('binance', {
      id: 'a', userId: 'u', exchange: 'binance', isActive: true, tradingMode: 'LIVE',
    })).toThrow(/does not match runtime mode/);
    expect(() => createExchange('binance', {
      id: 'a', userId: 'u', exchange: 'binance', isActive: true, tradingMode: 'TESTNET',
      isPaper: true,
    })).toThrow(/isPaper/);
    expect(() => createExchange('binance', {
      id: 'a', userId: 'u', exchange: 'binance', isActive: true,
    })).toThrow(/explicit tradingMode/);
  });

  it('blocks LIVE until LIVE_READY is true', () => {
    process.env.TRADING_MODE = 'LIVE';
    process.env.LIVE_TRADING_ENABLED = 'true';
    readiness.setPhase('SYSTEM_READY', 'test-ready');
    for (const key of [
      'DATABASE_READY',
      'CONFIG_VALID',
      'ACCOUNT_SYNC_READY',
      'ORDER_SYNC_READY',
      'POSITION_SYNC_READY',
      'EVENT_ROUTER_READY',
      'WEBSOCKET_READY',
      'RECONCILIATION_READY',
      'RISK_READY',
      'AI_READY',
      'LEARNING_READY',
      'STARTUP_GATE_READY',
    ] as const) readiness.setCheck(key, true);
    expect(() => assertExecutionAllowed('binance', { id: 'a', userId: 'u', exchange: 'binance', isActive: true, tradingMode: 'LIVE' }, readiness))
      .toThrow(/LIVE_READY/);
  });

  it('keeps HALTED fail-closed and does not reach submission', () => {
    process.env.TRADING_MODE = 'PAPER';
    process.env.LIVE_TRADING_ENABLED = 'false';
    readiness.halt('reconciliation failed');
    let submissions = 0;

    expect(() => {
      assertExecutionAllowed('paper', {
        id: 'paper-account',
        userId: 'paper-user',
        exchange: 'paper',
        isActive: true,
        isPaper: true,
        tradingMode: 'PAPER',
      }, readiness);
      submissions += 1;
    }).toThrow(/phase=HALTED/);

    expect(readiness.report().phase).toBe('HALTED');
    expect(readiness.canCreateNewEntry()).toBe(false);
    expect(submissions).toBe(0);
  });

  it('permits LIVE only when every explicit prerequisite is satisfied', () => {
    process.env.TRADING_MODE = 'LIVE';
    process.env.LIVE_TRADING_ENABLED = 'true';
    process.env.RISK_CONFIG_VERSION = 'risk-v1';
    markReady('LIVE');
    armLiveApproval({ operatorUserId: 'operator', accountId: 'a', riskConfigVersion: 'risk-v1' });
    expect(assertExecutionAllowed('binance', {
      id: 'a',
      userId: 'u',
      exchange: 'binance',
      isActive: true,
      tradingMode: 'LIVE',
    }, readiness).mode).toBe('LIVE');
  });

  it('rejects LIVE execution when the risk configuration version is absent', () => {
    process.env.TRADING_MODE = 'LIVE';
    process.env.LIVE_TRADING_ENABLED = 'true';
    markReady('LIVE');
    armLiveApproval({ operatorUserId: 'operator', accountId: 'a', riskConfigVersion: 'risk-v1' });
    expect(() => assertExecutionAllowed('binance', {
      id: 'a',
      userId: 'u',
      exchange: 'binance',
      isActive: true,
      tradingMode: 'LIVE',
    }, readiness)).toThrow(/RISK_CONFIG_VERSION/);
  });
});
