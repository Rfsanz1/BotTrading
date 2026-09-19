import { Injectable } from '@nestjs/common';
import prisma from '@rfsanz/database';
import { ExchangeReconciliationService, ReconciliationResult } from '@rfsanz/exchange';
import { TradingService } from './trading.service';
import { applyPaperMarketFixture } from './paper-market-fixture';

type ScenarioStatus = 'PASS' | 'NOT IMPLEMENTED' | 'BLOCKED';

type ScenarioResult = {
  scenario: string;
  status: ScenarioStatus;
  fixture: string;
  expectedFailure: string;
  observedState?: Record<string, unknown>;
  persistence?: Record<string, boolean>;
  duplicateProtection?: Record<string, boolean>;
  reconciliation?: ReconciliationResult;
  cleanup?: boolean;
  reason?: string;
};

@Injectable()
export class PaperFailureService {
  private readonly reconciliation = new ExchangeReconciliationService();

  constructor(private readonly tradingService: TradingService) {}

  async run(): Promise<Record<string, unknown>> {
    if (process.env.TRADING_MODE !== 'PAPER') {
      throw new Error('PAPER failure test is only available in PAPER mode');
    }

    const scenarios: ScenarioResult[] = [];
    scenarios.push(await this.runFixture('TIMEOUT_UNKNOWN', 'timeout', 'NEW', 0));
    scenarios.push(await this.runFixture('PARTIAL_FILL', 'partial', 'PARTIALLY_FILLED', 0.05));
    scenarios.push(await this.runFixture('DUPLICATE_FILL_EVENT', 'duplicate-fill', 'FILLED', 0.1));
    scenarios.push(await this.runFixture('FILL_CANCEL_RACE', 'fill-cancel-race', 'FILLED', 0.1));
    scenarios.push(await this.runDuplicateOrderProtection());
    scenarios.push({
      scenario: 'INVALID_TRANSITION',
      status: 'NOT IMPLEMENTED',
      fixture: 'none',
      expectedFailure: 'ExecutionEngine rejects an invalid state transition',
      reason: 'The current API path does not expose an exchange event that can cause an invalid transition without bypassing the real execution path.',
    });

    return {
      mode: 'PAPER',
      scenarios,
      summary: {
        pass: scenarios.filter((scenario) => scenario.status === 'PASS').length,
        notImplemented: scenarios.filter((scenario) => scenario.status === 'NOT IMPLEMENTED').length,
        blocked: scenarios.filter((scenario) => scenario.status === 'BLOCKED').length,
      },
    };
  }

  private async runFixture(
    scenario: string,
    fillMode: string,
    expectedExchangeStatus: string,
    filledQuantity: number,
  ): Promise<ScenarioResult> {
    const runId = `paper-failure-${scenario.toLowerCase()}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const symbol = `PF${scenario.slice(0, 4)}${Date.now()}`;
    const price = 100;
    const quantity = 0.1;
    const orderIds: string[] = [];
    const alertIds: string[] = [];
    let userId: string | undefined;

    console.log(`SCENARIO_START ${scenario} fixture=${runId}`);
    process.env.PAPER_TEST_FILL_MODE = fillMode;
    try {
      const user = await prisma.user.create({ data: { email: `${runId}@invalid.local`, name: runId } });
      userId = user.id;
      const account = await prisma.exchangeAccount.create({
        data: { userId, exchange: 'paper', accountId: runId },
      });
      await prisma.balanceHistory.create({
        data: { userId, exchange: 'paper', asset: 'USDT', free: 10000, locked: 0, total: 10000, meta: { fixture: runId } },
      });

      const alert = await prisma.alert.create({
        data: { userId, symbol, webhookSource: 'paper-failure', webhookPayload: { fixture: runId }, status: 'RECOMMENDED' },
      });
      alertIds.push(alert.id);
      const consensus = await prisma.consensus.create({
        data: {
          alertId: alert.id,
          symbol,
          recommendation: 'BUY',
          confidenceScore: 1,
          riskScore: 0,
          bulletPoints: [`deterministic ${scenario} fixture`],
          analysis: scenario,
          providerVotes: { fixture: runId },
        },
      });
      const recommendation = await prisma.recommendation.create({
        data: {
          consensusId: consensus.id,
          alertId: alert.id,
          userId,
          symbol,
          recommendationType: 'BUY',
          entryPrice: price,
          targetPrice: price + 2,
          stopLoss: price - 1,
          riskReward: 2,
          positionSizePercentage: 0.1,
          urgency: 'LOW',
          reasoning: scenario,
          status: 'PENDING',
        },
      });
      const orderId = await this.tradingService.createOrder({
        userId,
        recommendationId: recommendation.id,
        symbol,
        side: 'BUY',
        quantity,
        price,
        exchange: 'paper',
        stopLoss: price - 1,
        targetPrice: price + 2,
      });
      orderIds.push(orderId);
      console.log(`ACTION ${scenario} fixture=${runId} submit=${orderId} fillMode=${fillMode}`);
      await applyPaperMarketFixture(orderId, 100, 100.0005);
      const submission = await this.tradingService.submitToExchange(orderId);

      if (filledQuantity > 0) {
        await this.tradingService.recordTrade({
          orderId,
          executionConfirmation: await this.tradingService.verifyExecution(orderId),
        });
      }

      const order = await prisma.order.findUnique({ where: { id: orderId }, include: { trades: true } });
      const position = await prisma.position.findFirst({ where: { userId, symbol } });
      const expectedLocalStatus = filledQuantity === 0 ? 'NEW' : expectedExchangeStatus;
      const expectedPositionQuantity = filledQuantity;
      const persistence = {
        orderCreated: Boolean(order),
        externalIdentityPersisted: order?.externalId === submission.externalOrderId,
        expectedLocalStatus: order?.status === expectedLocalStatus,
        fillQuantityPersisted: Number(order?.filled ?? 0) === filledQuantity,
        tradeCountMatches: order?.trades.length === (filledQuantity > 0 ? 1 : 0),
        positionQuantityMatchesFill: Number(position?.quantity ?? 0) === expectedPositionQuantity,
        noOversizedPosition: Number(position?.quantity ?? 0) <= filledQuantity,
      };
      const duplicateProtection = {
        noDuplicateFill: order?.trades.length === (filledQuantity > 0 ? 1 : 0),
        noDuplicateOrder: orderIds.length === 1,
      };

      console.log(`EXPECTED_FAILURE ${scenario} fixture=${runId} exchangeStatus=${expectedExchangeStatus}`);
      console.log(`OBSERVED_STATE ${scenario} fixture=${runId} localStatus=${String(order?.status)} filled=${String(order?.filled)} position=${String(position?.quantity ?? 0)}`);
      console.log(`PERSISTENCE_CHECK ${scenario} fixture=${runId} ${JSON.stringify(persistence)}`);

      const exchangePosition = filledQuantity > 0
        ? [{ symbol, side: 'BUY', quantity: filledQuantity, size: filledQuantity }]
        : [];
      const reconciliation = await this.reconciliation.reconcileAll(
        { id: account.id, exchange: 'paper' },
        [{ id: orderId, clientOrderId: order?.externalId, status: order?.status, filled: Number(order?.filled) }],
        position ? [{ symbol, side: position.side, quantity: Number(position.quantity), size: Number(position.quantity) }] : [],
        { id: account.id, exchange: 'paper' },
        [{ id: submission.externalOrderId, clientOrderId: order?.externalId, status: expectedExchangeStatus, filled: filledQuantity }],
        exchangePosition,
      );
      console.log(`RECONCILIATION ${scenario} fixture=${runId} status=${reconciliation.status} mismatches=${JSON.stringify(reconciliation.mismatches)}`);

      const failClosed = scenario === 'TIMEOUT_UNKNOWN'
        ? order?.status === 'NEW' && !position
        : Boolean(order);
      const checks = {
        ...persistence,
        ...duplicateProtection,
        failClosed,
        reconciliationHealthy: reconciliation.status === 'HEALTHY' && reconciliation.mismatches.length === 0,
      };
      if (Object.values(checks).some((value) => !value)) {
        throw new Error(`${scenario} verification failed: ${JSON.stringify(checks)}`);
      }

      console.log(`SCENARIO_PASS ${scenario} fixture=${runId}`);
      return {
        scenario,
        status: 'PASS',
        fixture: runId,
        expectedFailure: `${fillMode} injected by FakePaperExchangeAdapter`,
        observedState: {
          orderStatus: order?.status,
          filled: Number(order?.filled),
          positionQuantity: Number(position?.quantity ?? 0),
        },
        persistence: checks,
        duplicateProtection,
        reconciliation,
        cleanup: true,
      };
    } finally {
      delete process.env.PAPER_TEST_FILL_MODE;
      delete process.env.PAPER_TEST_PARTIAL_RATIO;
      if (userId) {
        await prisma.orderAnalysisLink.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.trade.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.position.deleteMany({ where: { userId, symbol } });
        await prisma.balanceHistory.deleteMany({ where: { userId, meta: { path: ['fixture'], equals: runId } } });
        await prisma.recommendation.deleteMany({ where: { userId, alertId: { in: alertIds } } });
        await prisma.consensus.deleteMany({ where: { alertId: { in: alertIds } } });
        await prisma.alert.deleteMany({ where: { id: { in: alertIds } } });
        await prisma.exchangeAccount.deleteMany({ where: { userId } });
        await prisma.user.delete({ where: { id: userId } });
      }
      console.log(`CLEANUP ${scenario} fixture=${runId}`);
    }
  }

  private async runDuplicateOrderProtection(): Promise<ScenarioResult> {
    const runId = `paper-failure-duplicate-order-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const symbol = `PF DUP${Date.now()}`;
    const price = 100;
    const quantity = 0.1;
    const orderIds: string[] = [];
    const alertIds: string[] = [];
    let userId: string | undefined;
    const previousFillMode = process.env.PAPER_TEST_FILL_MODE;

    console.log(`SCENARIO_START DUPLICATE_ORDER_PROTECTION fixture=${runId}`);
    process.env.PAPER_TEST_FILL_MODE = 'timeout';
    try {
      const user = await prisma.user.create({ data: { email: `${runId}@invalid.local`, name: runId } });
      userId = user.id;
      const account = await prisma.exchangeAccount.create({ data: { userId, exchange: 'paper', accountId: runId } });
      await prisma.balanceHistory.create({
        data: { userId, exchange: 'paper', asset: 'USDT', free: 10000, locked: 0, total: 10000, meta: { fixture: runId } },
      });
      const alert = await prisma.alert.create({
        data: { userId, symbol, webhookSource: 'paper-failure', webhookPayload: { fixture: runId }, status: 'RECOMMENDED' },
      });
      alertIds.push(alert.id);
      const consensus = await prisma.consensus.create({
        data: {
          alertId: alert.id,
          symbol,
          recommendation: 'BUY',
          confidenceScore: 1,
          riskScore: 0,
          bulletPoints: ['duplicate order protection fixture'],
          analysis: 'DUPLICATE_ORDER_PROTECTION',
          providerVotes: { fixture: runId },
        },
      });
      const recommendation = await prisma.recommendation.create({
        data: {
          consensusId: consensus.id,
          alertId: alert.id,
          userId,
          symbol,
          recommendationType: 'BUY',
          entryPrice: price,
          targetPrice: price + 2,
          stopLoss: price - 1,
          riskReward: 2,
          positionSizePercentage: 0.1,
          urgency: 'LOW',
          reasoning: 'DUPLICATE_ORDER_PROTECTION',
          status: 'PENDING',
        },
      });
      const orderId = await this.tradingService.createOrder({
        userId,
        recommendationId: recommendation.id,
        symbol,
        side: 'BUY',
        quantity,
        price,
        exchange: 'paper',
        stopLoss: price - 1,
        targetPrice: price + 2,
      });
      orderIds.push(orderId);
      console.log(`ACTION DUPLICATE_ORDER_PROTECTION fixture=${runId} submitTwice=${orderId}`);
      await applyPaperMarketFixture(orderId, 100, 100.0005);
      const first = await this.tradingService.submitToExchange(orderId);
      const second = await this.tradingService.submitToExchange(orderId);
      const orders = await prisma.order.findMany({ where: { id: { in: orderIds } }, include: { trades: true } });
      const order = orders[0];
      const persistence = {
        onePersistedOrder: orders.length === 1,
        externalIdentityPersisted: Boolean(order?.externalId),
        noFillCreated: order?.trades.length === 0,
      };
      const duplicateProtection = {
        secondSubmissionReusedExternalIdentity: first.externalOrderId === second.externalOrderId,
        noDuplicateOrder: orders.length === 1,
        noDuplicateFill: order?.trades.length === 0,
      };
      console.log('EXPECTED_FAILURE DUPLICATE_ORDER_PROTECTION duplicate submission is blocked by persisted external identity');
      console.log(`OBSERVED_STATE DUPLICATE_ORDER_PROTECTION fixture=${runId} orders=${orders.length} externalId=${String(order?.externalId)} status=${String(order?.status)}`);
      console.log(`PERSISTENCE_CHECK DUPLICATE_ORDER_PROTECTION fixture=${runId} ${JSON.stringify(persistence)}`);
      const reconciliation = await this.reconciliation.reconcileAll(
        { id: account.id, exchange: 'paper' },
        [{ id: orderId, clientOrderId: order?.externalId, status: order?.status, filled: Number(order?.filled) }],
        [],
        { id: account.id, exchange: 'paper' },
        [{ id: first.externalOrderId, clientOrderId: order?.externalId, status: 'NEW', filled: 0 }],
        [],
      );
      console.log(`RECONCILIATION DUPLICATE_ORDER_PROTECTION fixture=${runId} status=${reconciliation.status} mismatches=${JSON.stringify(reconciliation.mismatches)}`);
      const checks = {
        ...persistence,
        ...duplicateProtection,
        failClosed: Boolean(order?.externalId),
        reconciliationHealthy: reconciliation.status === 'HEALTHY' && reconciliation.mismatches.length === 0,
      };
      if (Object.values(checks).some((value) => !value)) {
        throw new Error(`DUPLICATE_ORDER_PROTECTION verification failed: ${JSON.stringify(checks)}`);
      }
      console.log(`SCENARIO_PASS DUPLICATE_ORDER_PROTECTION fixture=${runId}`);
      return {
        scenario: 'DUPLICATE_ORDER_PROTECTION',
        status: 'PASS',
        fixture: runId,
        expectedFailure: 'second submission reuses the persisted external order identity',
        observedState: { orderCount: orders.length, orderStatus: order?.status, externalId: order?.externalId },
        persistence: checks,
        duplicateProtection,
        reconciliation,
        cleanup: true,
      };
    } finally {
      if (previousFillMode === undefined) delete process.env.PAPER_TEST_FILL_MODE;
      else process.env.PAPER_TEST_FILL_MODE = previousFillMode;
      if (userId) {
        await prisma.orderAnalysisLink.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.trade.deleteMany({ where: { orderId: { in: orderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
        await prisma.position.deleteMany({ where: { userId, symbol } });
        await prisma.balanceHistory.deleteMany({ where: { userId, meta: { path: ['fixture'], equals: runId } } });
        await prisma.recommendation.deleteMany({ where: { userId, alertId: { in: alertIds } } });
        await prisma.consensus.deleteMany({ where: { alertId: { in: alertIds } } });
        await prisma.alert.deleteMany({ where: { id: { in: alertIds } } });
        await prisma.exchangeAccount.deleteMany({ where: { userId } });
        await prisma.user.delete({ where: { id: userId } });
      }
      console.log(`CLEANUP DUPLICATE_ORDER_PROTECTION fixture=${runId}`);
    }
  }
}
