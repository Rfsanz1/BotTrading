import { Injectable } from '@nestjs/common';
import prisma from '@rfsanz/database';
import { ExchangeReconciliationService } from '@rfsanz/exchange';
import { TradingService } from './trading.service';
import { applyPaperMarketFixture } from './paper-market-fixture';

@Injectable()
export class PaperSmokeService {
  private readonly reconciliation = new ExchangeReconciliationService();

  constructor(private readonly tradingService: TradingService) {}

  async run(): Promise<Record<string, unknown>> {
    if (process.env.TRADING_MODE !== 'PAPER') {
      throw new Error('PAPER smoke fixture is only available when TRADING_MODE=PAPER');
    }

    const runId = `paper-smoke-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const email = `${runId}@invalid.local`;
    const symbol = `PAPER${Date.now()}`;
    const entryPrice = 100;
    const exitPrice = 101;
    const quantity = 0.1;
    const createdOrderIds: string[] = [];
    const createdAlertIds: string[] = [];
    let cleanupUserId: string | undefined;
    let entryExchangeOrder: any;
    let exitExchangeOrder: any;

    try {
      const user = await prisma.user.create({
        data: {
          email,
          name: runId,
        },
      });
      cleanupUserId = user.id;
      const fixtureUserId = user.id;

      const exchangeAccount = await prisma.exchangeAccount.create({
        data: {
          userId: fixtureUserId,
          exchange: 'paper',
          accountId: runId,
        },
      });

      await prisma.balanceHistory.create({
        data: {
          userId: fixtureUserId,
          exchange: 'paper',
          asset: 'USDT',
          free: 10000,
          locked: 0,
          total: 10000,
          meta: { fixture: runId },
        },
      });

      const createRecommendation = async (side: 'BUY' | 'SELL'): Promise<string> => {
        const alert = await prisma.alert.create({
          data: {
            userId: fixtureUserId,
            symbol,
            webhookSource: 'paper-smoke',
            webhookPayload: { fixture: runId },
            status: 'RECOMMENDED',
          },
        });
        createdAlertIds.push(alert.id);

        const consensus = await prisma.consensus.create({
          data: {
            alertId: alert.id,
            symbol,
            recommendation: side,
            confidenceScore: 1,
            riskScore: 0,
            bulletPoints: ['deterministic paper smoke fixture'],
            analysis: 'Certified PAPER smoke fixture',
            providerVotes: { fixture: runId },
          },
        });

        const recommendation = await prisma.recommendation.create({
          data: {
            consensusId: consensus.id,
            alertId: alert.id,
            userId: fixtureUserId,
            symbol,
            recommendationType: side,
            entryPrice: side === 'BUY' ? entryPrice : exitPrice,
            targetPrice: side === 'BUY' ? 102 : 99,
            stopLoss: side === 'BUY' ? 99 : 102,
            riskReward: 2,
            positionSizePercentage: 0.1,
            urgency: 'LOW',
            reasoning: 'deterministic paper smoke fixture',
            status: 'PENDING',
          },
        });
        return recommendation.id;
      };

      const entryRecommendationId = await createRecommendation('BUY');
      const entryOrderId = await this.tradingService.createOrder({
        userId: fixtureUserId,
        recommendationId: entryRecommendationId,
        symbol,
        side: 'BUY',
        quantity,
        price: entryPrice,
        exchange: 'paper',
        stopLoss: 99,
        targetPrice: 102,
      });
      createdOrderIds.push(entryOrderId);
      await applyPaperMarketFixture(entryOrderId, 100, 100.0005);
      const entrySubmission = await this.tradingService.submitToExchange(entryOrderId);
      const entryRecord = await prisma.order.findUnique({ where: { id: entryOrderId } });
      entryExchangeOrder = {
        id: entrySubmission.externalOrderId,
        clientOrderId: (entryRecord?.meta as { clientOrderId?: string })?.clientOrderId,
        status: 'FILLED',
        filled: quantity,
      };
      await this.tradingService.recordTrade({
        orderId: entryOrderId,
        executionConfirmation: await this.tradingService.verifyExecution(entryOrderId),
      });

      const exitRecommendationId = await createRecommendation('SELL');
      const exitOrderId = await this.tradingService.createOrder({
        userId: fixtureUserId,
        recommendationId: exitRecommendationId,
        symbol,
        side: 'SELL',
        quantity,
        price: exitPrice,
        exchange: 'paper',
        stopLoss: 102,
        targetPrice: 99,
      });
      createdOrderIds.push(exitOrderId);
      await applyPaperMarketFixture(exitOrderId, 100, 100.0005);
      const exitSubmission = await this.tradingService.submitToExchange(exitOrderId);
      const exitRecord = await prisma.order.findUnique({ where: { id: exitOrderId } });
      exitExchangeOrder = {
        id: exitSubmission.externalOrderId,
        clientOrderId: (exitRecord?.meta as { clientOrderId?: string })?.clientOrderId,
        status: 'FILLED',
        filled: quantity,
      };
      await this.tradingService.recordTrade({
        orderId: exitOrderId,
        executionConfirmation: await this.tradingService.verifyExecution(exitOrderId),
      });

      const orders = await prisma.order.findMany({
        where: { id: { in: createdOrderIds } },
        include: { trades: true },
      });
      const positions = await prisma.position.findMany({
        where: { userId: fixtureUserId, symbol },
      });
      const entryOrder = orders.find((order) => order.id === entryOrderId);
      const exitOrder = orders.find((order) => order.id === exitOrderId);
      const entryTrade = entryOrder?.trades[0];
      const exitTrade = exitOrder?.trades[0];
      const position = positions[0];
      const openPositions = positions.filter((item) => item.status === 'OPEN' && Number(item.quantity) > 0);
      const reconciliation = await this.reconciliation.reconcileAll(
        { id: exchangeAccount.id, exchange: 'paper' },
        [
          { id: entryOrderId, clientOrderId: entryExchangeOrder.clientOrderId, status: entryOrder?.status, filled: Number(entryOrder?.filled) },
          { id: exitOrderId, clientOrderId: exitExchangeOrder.clientOrderId, status: exitOrder?.status, filled: Number(exitOrder?.filled) },
        ],
        [],
        { id: exchangeAccount.id, exchange: 'paper' },
        [entryExchangeOrder, exitExchangeOrder],
        [],
      );

      const checks = {
        orderCreated: orders.length === 2,
        ordersAccepted: Boolean(entryOrder?.externalId && exitOrder?.externalId),
        ordersFilled: entryOrder?.status === 'FILLED' && exitOrder?.status === 'FILLED',
        fillsRecorded: Boolean(entryTrade && exitTrade),
        positionCreated: Boolean(position),
        positionQuantityMatchesFill: Number(entryTrade?.quantity) === quantity,
        closeExecuted: Number(exitTrade?.quantity) === quantity,
        finalPositionClosed: position?.status === 'CLOSED' && Number(position.quantity) === 0,
        tradeResultPersisted: Boolean(entryTrade?.id && exitTrade?.id),
        noOrphanOrderOrPosition: orders.every((order) => order.trades.length === 1) && openPositions.length === 0,
        reconciliationHealthy: reconciliation.status === 'HEALTHY' && reconciliation.mismatches.length === 0,
      };

      if (Object.values(checks).some((value) => !value)) {
        throw new Error(`PAPER fixture verification failed: ${JSON.stringify({ checks, mismatches: reconciliation.mismatches })}`);
      }

      return {
        fixture: runId,
        symbol,
        checks,
        reconciliation,
        orderIds: createdOrderIds,
        tradeIds: [entryTrade!.id, exitTrade!.id],
        positionId: position!.id,
      };
    } finally {
      if (cleanupUserId) {
        await prisma.orderAnalysisLink.deleteMany({ where: { orderId: { in: createdOrderIds } } });
        await prisma.trade.deleteMany({ where: { orderId: { in: createdOrderIds } } });
        await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
        await prisma.position.deleteMany({ where: { userId: cleanupUserId, symbol } });
        await prisma.balanceHistory.deleteMany({ where: { userId: cleanupUserId, meta: { path: ['fixture'], equals: runId } } });
        await prisma.recommendation.deleteMany({ where: { userId: cleanupUserId, alertId: { in: createdAlertIds } } });
        await prisma.consensus.deleteMany({ where: { alertId: { in: createdAlertIds } } });
        await prisma.alert.deleteMany({ where: { id: { in: createdAlertIds } } });
        await prisma.apiKey.deleteMany({ where: { userId: cleanupUserId } });
        await prisma.exchangeAccount.deleteMany({ where: { userId: cleanupUserId } });
        await prisma.user.delete({ where: { id: cleanupUserId } });
      }
    }
  }

      async runReconnectRecovery(
        disconnect: () => Promise<Record<string, unknown>>,
        reconnect: () => Promise<Record<string, unknown>>,
      ): Promise<Record<string, unknown>> {
        if (process.env.TRADING_MODE !== 'PAPER') throw new Error('PAPER reconnect recovery is only available in PAPER mode');
        const runId = `paper-reconnect-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const symbol = `RECONNECT${Date.now()}`;
        const quantity = 0.1;
        const orderIds: string[] = [];
        const alertIds: string[] = [];
        let userId: string | undefined;
        const createRecommendation = async (side: 'BUY' | 'SELL', price: number) => {
          const alert = await prisma.alert.create({
            data: { userId: userId!, symbol, webhookSource: 'paper-reconnect', webhookPayload: { fixture: runId }, status: 'RECOMMENDED' },
          });
          alertIds.push(alert.id);
          const consensus = await prisma.consensus.create({
            data: {
              alertId: alert.id, symbol, recommendation: side, confidenceScore: 1, riskScore: 0,
              bulletPoints: ['deterministic PAPER reconnect fixture'], analysis: 'Certified PAPER reconnect fixture',
              providerVotes: { fixture: runId },
            },
          });
          const recommendation = await prisma.recommendation.create({
            data: {
              consensusId: consensus.id, alertId: alert.id, userId: userId!, symbol,
              recommendationType: side,
              entryPrice: price,
              targetPrice: side === 'BUY' ? price + 2 : price - 2,
              stopLoss: side === 'BUY' ? price - 1 : price + 1,
              riskReward: 2,
              positionSizePercentage: 0.1,
              urgency: 'LOW', reasoning: 'deterministic PAPER reconnect fixture', status: 'PENDING',
            },
          });
          return recommendation.id;
        };
        const submit = async (side: 'BUY' | 'SELL', price: number) => {
          const id = await this.tradingService.createOrder({
            userId: userId!, recommendationId: await createRecommendation(side, price),
            symbol, side, quantity, price, exchange: 'paper',
            stopLoss: side === 'BUY' ? price - 1 : price + 1,
            targetPrice: side === 'BUY' ? price + 2 : price - 2,
          });
          orderIds.push(id);
          await applyPaperMarketFixture(id, 100, 100.0005);
          const result = await this.tradingService.submitToExchange(id);
          await this.tradingService.recordTrade({
            orderId: id,
            executionConfirmation: await this.tradingService.verifyExecution(id),
          });
          return { id, externalId: result.externalOrderId };
        };

        try {
          const user = await prisma.user.create({ data: { email: `${runId}@invalid.local`, name: runId } });
          userId = user.id;
          const account = await prisma.exchangeAccount.create({ data: { userId, exchange: 'paper', accountId: runId } });
          await prisma.balanceHistory.create({
            data: { userId, exchange: 'paper', asset: 'USDT', free: 10000, locked: 0, total: 10000, meta: { fixture: runId } },
          });
          const entry = await submit('BUY', 100);
          const before = await prisma.order.findUnique({ where: { id: entry.id }, include: { trades: true } });
          const beforePosition = await prisma.position.findFirst({ where: { userId, symbol, status: 'OPEN' } });
          if (!before || before.trades.length !== 1 || !beforePosition || Number(beforePosition.quantity) !== quantity) {
            throw new Error('PAPER reconnect fixture failed to persist open state');
          }
          const clientOrderId = (before.meta as { clientOrderId?: string })?.clientOrderId;
          const exchangeOrder = { id: entry.externalId, clientOrderId, status: 'FILLED', filled: quantity };
          console.log(`BEFORE_DISCONNECT fixture=${runId} order=${entry.id} position=${beforePosition.id} quantity=${beforePosition.quantity}`);

          const degraded = await disconnect();
          console.log(`DISCONNECT_TRIGGERED fixture=${runId}`);
          const degradedChecks = degraded.checks as Record<string, boolean> | undefined;
          console.log(`DEGRADED/RECONNECTING fixture=${runId} phase=${String(degraded.phase)} websocketReady=${String(degradedChecks?.WEBSOCKET_READY)}`);
          if (degraded.phase !== 'DEGRADED' || degradedChecks?.WEBSOCKET_READY !== false) {
            throw new Error(`PAPER reconnect did not enter degraded state: ${JSON.stringify(degraded)}`);
          }

          const recovered = await reconnect();
          const recoveredChecks = recovered.checks as Record<string, boolean> | undefined;
          console.log(`RECONNECT_COMPLETED fixture=${runId} phase=${String(recovered.phase)} websocketReady=${String(recoveredChecks?.WEBSOCKET_READY)}`);
          if (recovered.phase !== 'SYSTEM_READY' || recoveredChecks?.WEBSOCKET_READY !== true) {
            throw new Error(`PAPER reconnect did not restore readiness: ${JSON.stringify(recovered)}`);
          }

          const afterOrders = await prisma.order.findMany({ where: { id: entry.id }, include: { trades: true } });
          const afterPositions = await prisma.position.findMany({ where: { userId, symbol, status: 'OPEN' } });
          const after = afterOrders[0];
          const position = afterPositions[0];
          const reconciliation = await this.reconciliation.reconcileAll(
            { id: account.id, exchange: 'paper' },
            [{ id: entry.id, clientOrderId, status: after?.status, filled: Number(after?.filled) }],
            [{ symbol, side: position?.side, quantity: Number(position?.quantity), size: Number(position?.quantity) }],
            { id: account.id, exchange: 'paper' },
            [exchangeOrder],
            [{ symbol, side: 'BUY', quantity, size: quantity }],
          );
          console.log(`AFTER_RECONNECT fixture=${runId} order=${after?.id ?? 'missing'} position=${position?.id ?? 'missing'} quantity=${String(position?.quantity ?? 'missing')}`);
          const continuity = {
            originalOrderIdentity: after?.id === entry.id,
            noDuplicateOrder: afterOrders.length === 1,
            noDuplicateFill: after?.trades.length === 1,
            positionPreserved: Boolean(position),
            positionQuantityPreserved: Number(position?.quantity) === quantity,
            tradeLinkagePreserved: after?.trades[0]?.orderId === entry.id,
            noOrphanOrderOrPosition: Boolean(position) && reconciliation.mismatches.length === 0,
            reconciliationHealthy: reconciliation.status === 'HEALTHY' && reconciliation.mismatches.length === 0,
          };
          if (Object.values(continuity).some((value) => !value)) {
            throw new Error(`PAPER reconnect continuity failed: ${JSON.stringify({ continuity, mismatches: reconciliation.mismatches })}`);
          }

          const exit = await submit('SELL', 101);
          const finalOrders = await prisma.order.findMany({ where: { id: { in: orderIds } }, include: { trades: true } });
          const finalPosition = await prisma.position.findFirst({ where: { userId, symbol } });
          const finalChecks = {
            finalPositionClosed: finalPosition?.status === 'CLOSED' && Number(finalPosition.quantity) === 0,
            bothOrdersFilled: finalOrders.length === 2 && finalOrders.every((item) => item.status === 'FILLED'),
            tradeResultPersisted: finalOrders.every((item) => item.trades.length === 1),
          };
          if (Object.values(finalChecks).some((value) => !value)) throw new Error(`PAPER reconnect final close failed: ${JSON.stringify(finalChecks)}`);
          console.log(`FINAL_CLOSE fixture=${runId} order=${exit.id}`);
          return { fixture: runId, mode: 'PAPER', recovery: 'exchange-disconnect-and-lifecycle-reconnect', continuity, reconciliation, finalChecks, orderIds, positionId: finalPosition?.id };
        } finally {
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
            console.log(`CLEANUP fixture=${runId}`);
          }
        }
    }

  async runRestartRecovery(lifecycleRecovery: () => Promise<void>): Promise<Record<string, unknown>> {
        if (process.env.TRADING_MODE !== 'PAPER') {
          throw new Error('PAPER restart recovery is only available in PAPER mode');
        }

        const runId = `paper-restart-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
        const symbol = `RESTART${Date.now()}`;
        const entryPrice = 100;
        const exitPrice = 101;
        const quantity = 0.1;
        const createdOrderIds: string[] = [];
        const createdAlertIds: string[] = [];
        let cleanupUserId: string | undefined;

        try {
          const user = await prisma.user.create({ data: { email: `${runId}@invalid.local`, name: runId } });
          cleanupUserId = user.id;
          const exchangeAccount = await prisma.exchangeAccount.create({
            data: { userId: user.id, exchange: 'paper', accountId: runId },
          });
          await prisma.balanceHistory.create({
            data: {
              userId: user.id,
              exchange: 'paper',
              asset: 'USDT',
              free: 10000,
              locked: 0,
              total: 10000,
              meta: { fixture: runId },
            },
          });

          const recommendation = async (side: 'BUY' | 'SELL'): Promise<string> => {
            const alert = await prisma.alert.create({
              data: {
                userId: user.id,
                symbol,
                webhookSource: 'paper-restart',
                webhookPayload: { fixture: runId },
                status: 'RECOMMENDED',
              },
            });
            createdAlertIds.push(alert.id);
            const consensus = await prisma.consensus.create({
              data: {
                alertId: alert.id,
                symbol,
                recommendation: side,
                confidenceScore: 1,
                riskScore: 0,
                bulletPoints: ['deterministic in-process restart recovery fixture'],
                analysis: 'Certified PAPER restart recovery fixture',
                providerVotes: { fixture: runId },
              },
            });
            const record = await prisma.recommendation.create({
              data: {
                consensusId: consensus.id,
                alertId: alert.id,
                userId: user.id,
                symbol,
                recommendationType: side,
                entryPrice: side === 'BUY' ? entryPrice : exitPrice,
                targetPrice: side === 'BUY' ? 102 : 99,
                stopLoss: side === 'BUY' ? 99 : 102,
                riskReward: 2,
                positionSizePercentage: 0.1,
                urgency: 'LOW',
                reasoning: 'deterministic in-process restart recovery fixture',
              },
            });
            return record.id;
          };

          const entryOrderId = await this.tradingService.createOrder({
            userId: user.id,
            recommendationId: await recommendation('BUY'),
            symbol,
            side: 'BUY',
            quantity,
            price: entryPrice,
            exchange: 'paper',
            stopLoss: 99,
            targetPrice: 102,
          });
          createdOrderIds.push(entryOrderId);
          await applyPaperMarketFixture(entryOrderId, 100, 100.0005);
          const entrySubmission = await this.tradingService.submitToExchange(entryOrderId);
          await this.tradingService.recordTrade({
            orderId: entryOrderId,
            executionConfirmation: await this.tradingService.verifyExecution(entryOrderId),
          });

          const beforeOrders = await prisma.order.findMany({ where: { id: entryOrderId }, include: { trades: true } });
          const beforePositions = await prisma.position.findMany({ where: { userId: user.id, symbol, status: 'OPEN' } });
          console.log(`BEFORE_RECOVERY fixture=${runId} order=${entryOrderId} position=${beforePositions[0]?.id ?? 'missing'}`);

          console.log(`RECOVERY_STARTED fixture=${runId} mode=in-process-lifecycle-recovery`);
          await lifecycleRecovery();
          console.log(`RECOVERY_COMPLETED fixture=${runId}`);

          const afterOrders = await prisma.order.findMany({ where: { id: entryOrderId }, include: { trades: true } });
          const afterPositions = await prisma.position.findMany({ where: { userId: user.id, symbol, status: 'OPEN' } });
          const recoveredOrder = afterOrders[0];
          const recoveredPosition = afterPositions[0];
          const entryExchangeOrder = {
            id: entrySubmission.externalOrderId,
            clientOrderId: (beforeOrders[0]?.meta as { clientOrderId?: string })?.clientOrderId,
            status: 'FILLED',
            filled: quantity,
          };
          const recoveryReconciliation = await this.reconciliation.reconcileAll(
            { id: exchangeAccount.id, exchange: 'paper' },
            [{
              id: entryOrderId,
              clientOrderId: entryExchangeOrder.clientOrderId,
              status: recoveredOrder?.status,
              filled: Number(recoveredOrder?.filled),
            }],
            [],
            { id: exchangeAccount.id, exchange: 'paper' },
            [entryExchangeOrder],
            [],
          );
          console.log(`AFTER_RECOVERY fixture=${runId} order=${recoveredOrder?.id ?? 'missing'} position=${recoveredPosition?.id ?? 'missing'} quantity=${String(recoveredPosition?.quantity ?? 'missing')}`);

          const continuity = {
            originalOrderIdentity: recoveredOrder?.id === entryOrderId,
            originalFillNotDuplicated: recoveredOrder?.trades.length === 1,
            positionRecovered: Boolean(recoveredPosition),
            positionQuantityPreserved: Number(recoveredPosition?.quantity) === quantity,
            tradeLinkagePreserved: recoveredOrder?.trades[0]?.orderId === entryOrderId,
            noDuplicateOrder: afterOrders.length === 1,
            noOrphanState: Boolean(recoveredPosition) && recoveryReconciliation.mismatches.length === 0,
          };
          if (Object.values(continuity).some((value) => !value)) {
            throw new Error(`PAPER restart continuity failed: ${JSON.stringify({ continuity, mismatches: recoveryReconciliation.mismatches })}`);
          }

          const exitOrderId = await this.tradingService.createOrder({
            userId: user.id,
            recommendationId: await recommendation('SELL'),
            symbol,
            side: 'SELL',
            quantity,
            price: exitPrice,
            exchange: 'paper',
            stopLoss: 102,
            targetPrice: 99,
          });
          createdOrderIds.push(exitOrderId);
          await applyPaperMarketFixture(exitOrderId, 100, 100.0005);
          const exitSubmission = await this.tradingService.submitToExchange(exitOrderId);
          await this.tradingService.recordTrade({
            orderId: exitOrderId,
            executionConfirmation: await this.tradingService.verifyExecution(exitOrderId),
          });
          console.log(`FINAL_CLOSE fixture=${runId} order=${exitOrderId} external=${exitSubmission.externalOrderId}`);

          const finalOrders = await prisma.order.findMany({ where: { id: { in: createdOrderIds } }, include: { trades: true } });
          const finalPositions = await prisma.position.findMany({ where: { userId: user.id, symbol } });
          const closedPosition = finalPositions[0];
          const finalChecks = {
            finalPositionClosed: closedPosition?.status === 'CLOSED' && Number(closedPosition.quantity) === 0,
            bothOrdersFilled: finalOrders.length === 2 && finalOrders.every((order) => order.status === 'FILLED'),
            twoTradesLinked: finalOrders.every((order) => order.trades.length === 1),
            noOpenPosition: finalPositions.every((position) => position.status !== 'OPEN' || Number(position.quantity) === 0),
          };
          if (Object.values(finalChecks).some((value) => !value)) {
            throw new Error(`PAPER restart final close failed: ${JSON.stringify(finalChecks)}`);
          }
          return {
            fixture: runId,
            mode: 'PAPER',
            recovery: 'in-process-lifecycle-recovery',
            continuity,
            recoveryReconciliation,
            finalChecks,
            orderIds: createdOrderIds,
            positionId: closedPosition?.id,
          };
        } finally {
          if (cleanupUserId) {
            await prisma.orderAnalysisLink.deleteMany({ where: { orderId: { in: createdOrderIds } } });
            await prisma.trade.deleteMany({ where: { orderId: { in: createdOrderIds } } });
            await prisma.order.deleteMany({ where: { id: { in: createdOrderIds } } });
            await prisma.position.deleteMany({ where: { userId: cleanupUserId, symbol } });
            await prisma.balanceHistory.deleteMany({ where: { userId: cleanupUserId, meta: { path: ['fixture'], equals: runId } } });
            await prisma.recommendation.deleteMany({ where: { userId: cleanupUserId, alertId: { in: createdAlertIds } } });
            await prisma.consensus.deleteMany({ where: { alertId: { in: createdAlertIds } } });
            await prisma.alert.deleteMany({ where: { id: { in: createdAlertIds } } });
            await prisma.exchangeAccount.deleteMany({ where: { userId: cleanupUserId } });
            await prisma.user.delete({ where: { id: cleanupUserId } });
            console.log(`CLEANUP fixture=${runId}`);
        }
      }
  }
}
