import { AuthorizationService, authorizationService } from '../services/authorization.service';
import { RiskEngine, RiskEvaluationInput } from '../services/risk-engine';
import { OrderService } from '../services/order.service';
import { SystemReadinessService } from '../services/system-readiness.service';
import { createExchange } from '../factory';

jest.mock('../factory', () => ({
  createExchange: jest.fn(),
  listSupported: jest.fn(() => ['binance']),
}));

const mockCreateExchange = createExchange as jest.Mock;

function input(decisionId = 'decision-trust'): RiskEvaluationInput {
  return {
    trade: {
      decisionId,
      symbol: 'BTCUSDT',
      action: 'BUY',
      entry: 50000,
      stopLoss: 49000,
      takeProfit: 52000,
      requestedPositionSize: 1,
      riskAmount: 100,
      portfolioHeatBefore: 0,
      symbolExposureBefore: 0,
      correlatedExposureBefore: 0,
      leverage: 1,
      marginRequired: 50000,
      estimatedFees: 0,
      estimatedSlippage: 0,
      dailyPnL: 0,
      dailyLossLimit: 1000,
      drawdown: 0,
    },
    account: {
      totalEquity: 100000,
      availableBalance: 100000,
      marginUsed: 0,
      freeMargin: 100000,
      unrealizedPnL: 0,
      realizedPnL: 0,
      leverage: 1,
      peakEquity: 100000,
      currentDrawdown: 0,
      dailyPnL: 0,
      weeklyPnL: 0,
      consecutiveLosses: 0,
      tradingEnabled: true,
      killSwitch: false,
    },
    positions: [],
    market: { spread: 0, liquidity: 1, slippage: 0, stale: false, volatility: 0 },
  };
}

function ready() {
  process.env.TRADING_MODE = 'TESTNET';
  process.env.LIVE_TRADING_ENABLED = 'false';
  const service = SystemReadinessService.getInstance();
  service.setPhase('SYSTEM_READY', 'test');
  for (const key of [
    'DATABASE_READY', 'CONFIG_VALID', 'ACCOUNT_SYNC_READY', 'ORDER_SYNC_READY',
    'POSITION_SYNC_READY', 'EVENT_ROUTER_READY', 'WEBSOCKET_READY',
    'RECONCILIATION_READY', 'RISK_READY', 'AI_READY', 'LEARNING_READY',
    'STARTUP_GATE_READY', 'TESTNET_READY',
  ] as const) service.setCheck(key, true);
}

describe('authorization trust boundary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    ready();
  });

  it('rejects fabricated risk approvals and authorizations', () => {
    const service = new AuthorizationService();
    expect(() => service.issueFromDecision({ approved: true } as any, {
      mode: 'TESTNET', accountId: 'acct', symbol: 'BTCUSDT', side: 'BUY', quantity: 1,
    })).toThrow(/originate from RiskEngine/);

    expect(service.verify({
      status: 'APPROVED',
      decisionId: 'decision-trust',
      riskDecisionId: 'risk-trust',
      riskVersion: 'risk-v1',
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 1,
      entry: 50000,
      mode: 'TESTNET',
      accountId: 'acct',
      issuedAt: Date.now(),
      expiresAt: Date.now() + 10000,
    }, {
      decisionId: 'decision-trust',
      riskDecisionId: 'risk-trust',
      riskVersion: 'risk-v1',
      symbol: 'BTCUSDT',
      side: 'BUY',
      quantity: 1,
      entry: 50000,
      mode: 'TESTNET',
      accountId: 'acct',
    })).toBe(false);
  });

  it.each([
    ['decisionId', { decisionId: 'wrong' }],
    ['riskDecisionId', { riskDecisionId: 'wrong' }],
    ['riskVersion', { riskVersion: 'wrong' }],
    ['symbol', { symbol: 'ETHUSDT' }],
    ['side', { side: 'SELL' as const }],
    ['quantity', { quantity: 2 }],
    ['mode', { mode: 'PAPER' as const }],
    ['account', { accountId: 'other' }],
  ])('rejects mismatched %s', (_name, patch: any) => {
    const decision = new RiskEngine().evaluate(input());
    const auth = authorizationService.issueFromDecision(decision, {
      mode: 'TESTNET', accountId: 'acct', symbol: 'BTCUSDT', side: 'BUY', quantity: 1,
    });
    expect(authorizationService.verify(auth, {
      decisionId: patch.decisionId ?? auth.decisionId,
      riskDecisionId: patch.riskDecisionId ?? auth.riskDecisionId,
      riskVersion: patch.riskVersion ?? auth.riskVersion,
      symbol: patch.symbol ?? auth.symbol,
      side: patch.side ?? auth.side,
      quantity: patch.quantity ?? auth.quantity,
      entry: auth.entry,
      mode: patch.mode ?? auth.mode,
      accountId: patch.accountId ?? auth.accountId,
    })).toBe(false);
  });

  it('rejects expired and replayed authorization', () => {
    const decision = new RiskEngine().evaluate(input());
    const auth = authorizationService.issueFromDecision(decision, {
      mode: 'TESTNET', accountId: 'acct', symbol: 'BTCUSDT', side: 'BUY', quantity: 1,
    });
    const now = Date.now;
    jest.spyOn(Date, 'now').mockReturnValue(auth.expiresAt + 1);
    expect(authorizationService.verify(auth, {
      decisionId: auth.decisionId, riskDecisionId: auth.riskDecisionId, riskVersion: auth.riskVersion,
      symbol: auth.symbol, side: auth.side, quantity: auth.quantity, entry: auth.entry,
      mode: auth.mode, accountId: auth.accountId,
    })).toBe(false);
    jest.spyOn(Date, 'now').mockImplementation(now);

    const valid = authorizationService.issueFromDecision(new RiskEngine().evaluate(input('decision-replay')), {
      mode: 'TESTNET', accountId: 'acct', symbol: 'BTCUSDT', side: 'BUY', quantity: 1,
    });
    authorizationService.consume(valid, 'client-1');
    expect(() => authorizationService.consume(valid, 'client-1')).toThrow(/replay/);
  });

  it('allows only a canonical trusted authorization to reach the adapter', async () => {
    const fakeExchange = {
      connect: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn().mockResolvedValue(undefined),
      placeOrder: jest.fn().mockResolvedValue({
        id: 'external-1', clientOrderId: 'decision-canonical-v1', symbol: 'BTCUSDT',
        side: 'buy', quantity: '1', filled: '0', status: 'NEW', createdAt: new Date(),
      }),
    };
    mockCreateExchange.mockReturnValue(fakeExchange);
    const decision = new RiskEngine().evaluate(input('decision-canonical'));
    const auth = authorizationService.issueFromDecision(decision, {
      mode: 'TESTNET', accountId: 'acct', symbol: 'BTCUSDT', side: 'BUY', quantity: 1,
    });
    const result = await new OrderService().place('acct', 'binance', {
      symbol: 'BTCUSDT', side: 'buy', type: 'limit', quantity: '1', price: '50000',
    }, 'decision-canonical', auth, {
      id: 'acct', userId: 'user', exchange: 'binance', isActive: true, tradingMode: 'TESTNET',
    });
    expect(result.id).toBe('external-1');
    expect(fakeExchange.placeOrder).toHaveBeenCalledTimes(1);
  });

  it('rejects direct OrderService.place without canonical authorization', async () => {
    await expect(new OrderService().place('acct', 'binance', {
      symbol: 'BTCUSDT', side: 'buy', type: 'limit', quantity: '1', price: '50000',
    }, 'decision-direct', undefined as any, {
      id: 'acct', userId: 'user', exchange: 'binance', isActive: true, tradingMode: 'TESTNET',
    })).rejects.toThrow(/trusted execution authorization/i);
  });
});
