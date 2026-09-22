import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import prisma from '@rfsanz/database';
import {
  SymbolValidator,
  PositionService,
  BalanceSyncService,
  PnLCalculationService,
  RiskEngine,
  ExchangeEventRouter,
  SystemReadinessService,
  assertExecutionAllowed,
  orderService,
  authorizationService,
  executionConfirmationService,
  buildCanonicalClientOrderId,
  TrustedExecutionConfirmation,
  resolveTradeIntent,
  calculateDirectionalPnL,
  calculateFillDelta,
  CredentialCryptoService,
  fetchCanonicalMarketSnapshot,
  assertLiveEntryProtectionReady,
  ProtectionOrderService,
} from '@rfsanz/exchange';
import {
  OrderValidationStartedEvent,
  PositionSizeCalculatedEvent,
  OrderSubmittedToExchangeEvent,
  OrderFilledEvent,
  TradeRecordedEvent,
  PositionUpdatedEvent,
  OrderFailedEvent,
} from '../../domain/events';
import { EVENT_NAMES } from '../../domain/events/event-names';
import {
  OrderNotFoundException,
  OrderCreationFailedException,
  OrderValidationFailedException,
  PositionSizeCalculationFailedException,
  RiskLimitExceededException,
} from '../../domain/exceptions';
import { resolveCanonicalTestnetAccount } from './canonical-testnet-account';
import { resolveCanonicalLiveAccount } from './canonical-live-account';
import { getKillSwitch, setKillSwitch } from './kill-switch';

@Injectable()
export class TradingService {
  private readonly logger = new Logger(TradingService.name);
  private credentialCrypto?: CredentialCryptoService;
  private readonly exchangeRouter: ExchangeEventRouter;
  private readonly wiredAdapters = new WeakSet<object>();

  constructor(
    private readonly eventEmitter: EventEmitter2,
    private readonly symbolValidator: SymbolValidator,
    public readonly positionService: PositionService,
    public readonly balanceSyncService: BalanceSyncService,
    public readonly pnlCalculationService: PnLCalculationService,
  ) {
    this.exchangeRouter = new ExchangeEventRouter((event) => this.persistExchangeEvent(event));
  }

  wireExchangeAdapter(adapter: { on?: (event: string, handler: (payload: any) => void) => void; off?: (event: string, handler: (payload: any) => void) => void }): (() => void) | undefined {
    if (!adapter || typeof adapter.on !== 'function') {
      return undefined;
    }

    if (this.wiredAdapters.has(adapter as object)) {
      return undefined;
    }

    const listener = (payload: any) => {
      this.exchangeRouter.handle(payload);
    };

    adapter.on('user-data-event', listener);
    this.wiredAdapters.add(adapter as object);

    return () => {
      if (typeof adapter.off === 'function') {
        adapter.off('user-data-event', listener);
      }
      this.wiredAdapters.delete(adapter as object);
    };
  }

  async persistExchangeEvent(event: {
        kind: 'ORDER' | 'FILL' | 'ACCOUNT' | 'POSITION';
        source: string;
        orderId?: string;
        clientOrderId?: string;
        exchangeTradeId?: string;
        symbol?: string;
        side?: string;
        status?: string;
        filledQuantity?: number;
        averagePrice?: number;
        price?: number;
        fee?: number;
        feeAsset?: string;
        timestamp?: number;
      }): Promise<void> {
        if (event.kind !== 'FILL' && event.kind !== 'ORDER') return;

        const order = await prisma.order.findFirst({
          where: {
            OR: [
              event.orderId ? { externalId: event.orderId } : undefined,
              event.clientOrderId
                ? { meta: { path: ['clientOrderId'], equals: event.clientOrderId } }
                : undefined,
            ].filter(Boolean) as any,
          },
          include: {
            user: {
              include: {
                exchangeAccounts: {
                  where: { exchange: event.source, isActive: true },
                  select: { id: true },
                },
              },
            },
          },
        });
        if (!order) {
          const handled = await this.handleProtectionFill(event);
          if (!handled) {
            this.logger.warn(`UNKNOWN exchange event: source=${event.source} orderId=${event.orderId ?? 'none'} clientOrderId=${event.clientOrderId ?? 'none'}`);
          }
          return;
        }

        if (event.kind === 'ORDER') {
          if (!event.status) return;
          await prisma.order.update({
            where: { id: order.id },
            data: {
              externalId: event.orderId ?? order.externalId,
              filled: Math.max(Number(order.filled), Number(event.filledQuantity ?? 0)),
              status: event.status as any,
            },
          });
          return;
        }

        if (!event.exchangeTradeId || !event.orderId || !event.symbol || !event.side) {
          throw new Error('Unverifiable fill event rejected');
        }
        if (event.symbol !== order.symbol || event.side.toUpperCase() !== order.side) {
          throw new Error('Fill identity does not match the local order');
        }

        const accountId = process.env.TRADING_MODE === 'TESTNET'
          ? (await resolveCanonicalTestnetAccount(order.userId)).id
          : order.user.exchangeAccounts[0]?.id;
        const executionKey = `${event.source}:${accountId ?? 'unknown'}:${event.orderId}:${event.exchangeTradeId}`;
        const cumulative = Number(event.filledQuantity ?? 0);
        const executionPrice = Number(event.averagePrice ?? event.price ?? 0);
        if (!Number.isFinite(executionPrice) || executionPrice <= 0 || !Number.isFinite(cumulative) || cumulative <= 0) {
          throw new Error('Unverifiable fill values rejected');
        }

        await prisma.$transaction(async (tx) => {
          const existing = await tx.trade.findUnique({ where: { executionKey } });
          if (existing) return;

          const currentFilled = Number(order.filled);
          const rawFillQuantity = calculateFillDelta(cumulative, currentFilled);
          const baseAsset = order.symbol.replace(/USDT$|USDC$|BUSD$|BTC$|ETH$/, '');
          const feeInBaseAsset = event.feeAsset?.toUpperCase() === baseAsset;
          const fillQuantity = Math.max(0, rawFillQuantity - (feeInBaseAsset ? Number(event.fee ?? 0) : 0));
          if (fillQuantity <= 0 || fillQuantity > Number(order.quantity) - currentFilled + 1e-9) {
            throw new Error('Cumulative fill is inconsistent with local order state');
          }

          await tx.trade.create({
            data: {
              orderId: order.id,
              exchange: event.source,
              exchangeAccountId: accountId,
              exchangeOrderId: event.orderId,
              exchangeTradeId: event.exchangeTradeId,
              executionKey,
              price: executionPrice,
              quantity: fillQuantity,
              fee: event.fee,
              feeAsset: event.feeAsset,
              side: order.side,
              timestamp: event.timestamp ? new Date(event.timestamp) : new Date(),
              exchangeTimestamp: event.timestamp ? new Date(event.timestamp) : null,
            },
          });
          await tx.order.update({
            where: { id: order.id },
            data: {
              filled: cumulative,
              status: event.status === 'PARTIALLY_FILLED' || cumulative < Number(order.quantity)
                ? 'PARTIALLY_FILLED'
                : 'FILLED',
            },
          });

          const position = await tx.position.findFirst({
            where: { userId: order.userId, symbol: order.symbol, status: 'OPEN' },
          });
          if (!position) {
            await tx.position.create({
              data: {
                userId: order.userId,
                symbol: order.symbol,
                side: order.side,
                quantity: fillQuantity,
                entryPrice: executionPrice,
                status: 'OPEN',
              },
            });
            return;
          }
          if (position.side === order.side) {
            const oldQuantity = Number(position.quantity);
            const nextQuantity = oldQuantity + fillQuantity;
            await tx.position.update({
              where: { id: position.id },
              data: {
                quantity: nextQuantity,
                entryPrice: (oldQuantity * Number(position.entryPrice) + fillQuantity * executionPrice) / nextQuantity,
              },
            });
            return;
          }
          const remaining = Number(position.quantity) - fillQuantity;
          if (remaining < -1e-9) throw new Error('Authoritative fill would over-close position');
          const pnl = calculateDirectionalPnL(
            Number(position.entryPrice),
            executionPrice,
            Math.min(fillQuantity, Number(position.quantity)),
            position.side as 'BUY' | 'SELL',
            Number(event.fee ?? 0),
          );
          await tx.position.update({
            where: { id: position.id },
            data: remaining <= 1e-9
              ? { quantity: 0, status: 'CLOSED', closedAt: new Date(), realizedPnL: Number(position.realizedPnL ?? 0) + pnl }
              : { quantity: remaining, realizedPnL: Number(position.realizedPnL ?? 0) + pnl },
          });
        });
        if (order.side === 'BUY' && ((order.meta as Record<string, unknown> | null | undefined)?.intent ?? 'ENTRY') === 'ENTRY') {
          const position = await prisma.position.findFirst({
            where: { userId: order.userId, symbol: order.symbol, status: 'OPEN' },
          });
          if (position) await this.ensureEntryProtection(order, position);
        }
  }

  private async ensureEntryProtection(order: any, position: any): Promise<void> {
    const meta = (order.meta ?? {}) as Record<string, unknown>;
    const stopLoss = Number(meta.stopLoss);
    const takeProfit = Number(meta.targetPrice);
    if (!Number.isFinite(stopLoss) || !Number.isFinite(takeProfit) || stopLoss <= 0 || takeProfit <= 0) {
      await setKillSwitch(true, `Entry ${order.id} has no valid SL/TP protection`);
      await this.eventEmitter.emitAsync('trading.protection.failed', { orderId: order.id, positionId: position.id, reason: 'missing SL/TP' });
      return;
    }
    const account = await this.resolveExecutionAccount(order.userId, order.exchange);
    const { createExchange } = await import('@rfsanz/exchange');
    const adapter: any = createExchange(order.exchange as any, account);
    if (!adapter.nativeProtectionVerified || typeof adapter.createProtectionOco !== 'function') {
      await setKillSwitch(true, `Protection capability is unverified for entry ${order.id}`);
      await this.eventEmitter.emitAsync('trading.protection.failed', { orderId: order.id, positionId: position.id, reason: 'unverified OCO capability' });
      return;
    }
    const listClientOrderId = `pos-${position.id}-oco`;
    const positionMeta = (position.meta ?? {}) as Record<string, unknown>;
    if (positionMeta.protectionListClientOrderId === listClientOrderId && positionMeta.protectionState === 'CONFIRMED') return;
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await adapter.connect(account);
        const protection = await adapter.createProtectionOco({
          symbol: position.symbol,
          side: 'sell',
          quantity: String(position.quantity),
          stopLossTriggerPrice: String(stopLoss),
          stopLossLimitPrice: String(stopLoss),
          takeProfitTriggerPrice: String(takeProfit),
          takeProfitLimitPrice: String(takeProfit),
          listClientOrderId,
          stopLossClientOrderId: `${listClientOrderId}-sl`,
          takeProfitClientOrderId: `${listClientOrderId}-tp`,
        });
        await prisma.position.update({
          where: { id: position.id },
          data: {
            meta: {
              ...positionMeta,
              protectionState: 'CONFIRMED',
              protectionListClientOrderId: listClientOrderId,
              protectionListId: protection.externalId ?? protection.id,
              stopLossProtectionClientOrderId: `${listClientOrderId}-sl`,
              takeProfitProtectionClientOrderId: `${listClientOrderId}-tp`,
            } as any,
          },
        });
        await adapter.disconnect();
        return;
      } catch (error) {
        lastError = error;
        try { await adapter.disconnect(); } catch { /* preserve original protection failure */ }
      }
    }
    await prisma.position.update({
      where: { id: position.id },
      data: { meta: { ...positionMeta, protectionState: 'FAILED' } as any },
    });
    await setKillSwitch(true, `Protection failed for entry ${order.id}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
    await this.eventEmitter.emitAsync('trading.protection.failed', { orderId: order.id, positionId: position.id, reason: String(lastError) });
  }

  private async handleProtectionFill(event: {
    source: string;
    orderId?: string;
    clientOrderId?: string;
    symbol?: string;
    averagePrice?: number;
    price?: number;
    filledQuantity?: number;
    fee?: number;
    feeAsset?: string;
    timestamp?: number;
  }): Promise<boolean> {
    if (!event.clientOrderId && !event.orderId) return false;
    const positions = await prisma.position.findMany({ where: { status: 'OPEN', ...(event.symbol ? { symbol: event.symbol } : {}) } });
    const position = positions.find((candidate) => {
      const meta = (candidate.meta ?? {}) as Record<string, unknown>;
      return [meta.protectionListId, meta.protectionListClientOrderId, meta.stopLossProtectionClientOrderId, meta.takeProfitProtectionClientOrderId]
        .some((value) => value === event.clientOrderId || value === event.orderId);
    });
    if (!position) return false;
    const quantity = Math.min(Number(position.quantity), Number(event.filledQuantity ?? 0));
    const exitPrice = Number(event.averagePrice ?? event.price ?? 0);
    if (quantity <= 0 || !Number.isFinite(exitPrice) || exitPrice <= 0) throw new Error('Unverifiable protection fill values rejected');
    const pnl = calculateDirectionalPnL(Number(position.entryPrice), exitPrice, quantity, position.side as 'BUY' | 'SELL', Number(event.fee ?? 0));
    await prisma.position.update({
      where: { id: position.id },
      data: {
        quantity: Math.max(0, Number(position.quantity) - quantity),
        status: quantity >= Number(position.quantity) ? 'CLOSED' : 'OPEN',
        closedAt: quantity >= Number(position.quantity) ? new Date() : null,
        realizedPnL: Number(position.realizedPnL ?? 0) + pnl,
      },
    });
    await this.eventEmitter.emitAsync('trading.protection.filled', { positionId: position.id, source: event.source, quantity, pnl });
    return true;
  }

  /**
   * Create order from recommendation
   */
  async createOrder(params: {
    userId: string;
    recommendationId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    quantity: number;
    price: number;
    exchange: string;
    stopLoss?: number;
    targetPrice?: number;
    intent?: 'ENTRY' | 'EXIT' | 'REDUCE' | 'CLOSE' | 'REVERSAL';
    positionId?: string;
  }): Promise<string> {
    try {
      this.logger.log(`Creating order for ${params.symbol} - ${params.side} ${params.quantity} @ ${params.price}`);

      // Validate order
      this.validateOrder(params);
      if (params.side === 'SELL' && (!params.positionId || !['EXIT', 'REDUCE', 'CLOSE'].includes(params.intent ?? ''))) {
        throw new OrderValidationFailedException('Binance Spot is long-only: SELL entry requires an existing long position and an explicit exit intent');
      }
      if (params.positionId) {
        const position = await prisma.position.findUnique({ where: { id: params.positionId } });
        if (!position || position.status !== 'OPEN' || position.userId !== params.userId || position.symbol !== params.symbol) {
          throw new OrderValidationFailedException('Order position is invalid');
        }
        const resolvedIntent = resolveTradeIntent(params.side, {
          side: position.side as 'BUY' | 'SELL',
          quantity: Number(position.quantity),
        }, params.quantity);
        if (resolvedIntent === 'REVERSAL') {
          throw new OrderValidationFailedException('Orders exceeding an existing position require explicit reversal support');
        }
      }
      if (params.intent === 'EXIT' || params.intent === 'REDUCE' || params.intent === 'CLOSE') {
        if (!params.positionId) throw new OrderValidationFailedException('Exit order requires position identity');
        const position = await prisma.position.findUnique({ where: { id: params.positionId } });
        if (!position || position.status !== 'OPEN' || position.userId !== params.userId || position.symbol !== params.symbol) {
          throw new OrderValidationFailedException('Exit order position is invalid');
        }
        const oppositeSide = position.side === 'BUY' ? 'SELL' : 'BUY';
        if (params.side !== oppositeSide) throw new OrderValidationFailedException('Exit order side does not oppose position');
        if (params.quantity > Number(position.quantity) + 1e-9) {
          throw new OrderValidationFailedException('Exit order quantity exceeds closable position quantity');
        }
        const resolvedIntent = resolveTradeIntent(params.side, {
          side: position.side as 'BUY' | 'SELL',
          quantity: Number(position.quantity),
        }, params.quantity);
        if (resolvedIntent !== params.intent && !(params.intent === 'EXIT' && resolvedIntent === 'CLOSE')) {
          throw new OrderValidationFailedException(`Exit order intent mismatch: resolved ${resolvedIntent}`);
        }
      }

      let marketSnapshot: Record<string, unknown> | undefined;
      if (process.env.TRADING_MODE === 'TESTNET') {
        const account = await this.resolveExecutionAccount(params.userId, params.exchange);
        const { createExchange } = await import('@rfsanz/exchange');
        const marketAdapter = createExchange(params.exchange as any, account);
        try {
          await marketAdapter.connect(account);
          const snapshot = await fetchCanonicalMarketSnapshot(marketAdapter, {
            symbol: params.symbol,
            side: params.side,
            quantity: params.quantity,
          });
          marketSnapshot = {
            bid: snapshot.bid,
            ask: snapshot.ask,
            mid: snapshot.mid,
            spread: snapshot.spread,
            spreadBps: snapshot.spreadBps,
            liquidity: snapshot.liquidity,
            slippage: snapshot.slippage,
            volatility: snapshot.volatility,
            stale: snapshot.stale,
            marketTimestamp: new Date(snapshot.timestamp).toISOString(),
            marketSource: snapshot.source,
            marketAuthority: snapshot.authority,
          };
        } finally {
          await marketAdapter.disconnect();
        }
      }

      // Create order in database
      const order = await prisma.order.create({
        data: {
          userId: params.userId,
          symbol: params.symbol,
          side: params.side as any,
          quantity: params.quantity,
          price: params.price,
          exchange: params.exchange,
          status: 'NEW',
          meta: {
            recommendationId: params.recommendationId,
            stopLoss: params.stopLoss,
            targetPrice: params.targetPrice,
            intent: params.intent ?? 'ENTRY',
            positionId: params.positionId,
            ...(marketSnapshot ?? {}),
            createdAt: new Date(),
          },
        },
      });

      // Link order to recommendation
      await prisma.orderAnalysisLink.create({
        data: {
          orderId: order.id,
          alertId: (await this.getRecommendationAlert(params.recommendationId, params.userId)).id,
          recommendationId: params.recommendationId,
        },
      });

      // Publish event
      const event = new OrderValidationStartedEvent(
        order.id,
        params.userId,
        params.symbol,
        params.quantity,
        params.price,
      );
      await this.eventEmitter.emitAsync(EVENT_NAMES.orderValidationStarted, event);

      this.logger.log(`Order created: ${order.id}`);
      return order.id;
    } catch (error) {
      this.logger.error(`Failed to create order: ${error.message}`, error.stack);
      throw error;
    }

  }

  async assertOrderOwner(orderId: string, userId: string): Promise<void> {
    const order = await prisma.order.findUnique({ where: { id: orderId }, select: { userId: true } });
    if (!order || order.userId !== userId) throw new Error('Order is not accessible for this user');
  }

  async assertPositionOwner(positionId: string, userId: string): Promise<void> {
    const position = await prisma.position.findUnique({ where: { id: positionId }, select: { userId: true } });
    if (!position || position.userId !== userId) throw new Error('Position is not accessible for this user');
  }

  /**
   * Calculate position size based on risk
   */
  async calculatePositionSize(params: {
    orderId: string;
    entryPrice: number;
    stopLoss: number;
    accountBalance: number;
    riskPercentage: number;
  }): Promise<{ quantity: number; riskAmount: number }> {
    try {
      // Validate inputs
      if (params.riskPercentage < 0.1 || params.riskPercentage > 10) {
        throw new PositionSizeCalculationFailedException('Risk percentage must be between 0.1% and 10%');
      }

      if (params.entryPrice <= 0 || params.stopLoss < 0) {
        throw new PositionSizeCalculationFailedException('Invalid price values');
      }

      const riskAmount = (params.accountBalance * params.riskPercentage) / 100;
      const priceDistance = Math.abs(params.entryPrice - params.stopLoss);

      if (priceDistance === 0) {
        throw new PositionSizeCalculationFailedException('Entry price and stop loss cannot be the same');
      }

      const quantity = riskAmount / priceDistance;

      // Update order with calculated position size
      await prisma.order.update({
        where: { id: params.orderId },
        data: {
          quantity,
          meta: {
            calculatedQuantity: quantity,
            riskAmount,
          },
        },
      });

      // Publish event
      const order = (await prisma.order.findUnique({ where: { id: params.orderId } })) as any;
      const event = new PositionSizeCalculatedEvent(
        params.orderId,
        order!.userId,
        order!.symbol,
        quantity,
        riskAmount,
        (quantity * params.entryPrice) / params.accountBalance,
      );
      await this.eventEmitter.emitAsync(EVENT_NAMES.positionSizeCalculated, event);

      this.logger.log(`Position size calculated: ${quantity} units for order ${params.orderId}`);

      return { quantity, riskAmount };
    } catch (error) {
      this.logger.error(`Failed to calculate position size: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Submit order to exchange
   * PHASE 1: Real exchange execution
   */
  async submitToExchange(orderId: string): Promise<{ success: boolean; externalOrderId?: string }> {
    let exchangeAdapter: any = null;
    let pendingClientOrderId: string | undefined;
    let pendingSymbol: string | undefined;
    
    try {
      const killSwitch = await getKillSwitch();
      const requestedOrder = await prisma.order.findUnique({ where: { id: orderId }, select: { meta: true } });
      const requestedIntent = (requestedOrder?.meta as Record<string, unknown> | null | undefined)?.intent;
      if (killSwitch.active && !['EXIT', 'REDUCE', 'CLOSE'].includes(String(requestedIntent))) {
        throw new RiskLimitExceededException(`Kill switch active: ${killSwitch.reason ?? 'entry blocked'}`);
      }
      const order = (await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: {
            include: {
              exchangeAccounts: {
                where: { isActive: true },
                include: {
                  apiKeys: { where: { revoked: false } },
                },
              },
            },
          },
        },
      })) as any;

      if (!order) {
        throw new OrderNotFoundException(orderId);
      }

      const existingMeta = (order.meta as Record<string, unknown> | null | undefined) ?? {};
      if (existingMeta.submissionState === 'UNKNOWN') {
        throw new OrderValidationFailedException(
          `Order ${orderId} has an unresolved exchange submission; reconcile before retry`,
        );
      }

      if (order.externalId) {
        this.logger.warn(`Order ${orderId} already has external ID: ${order.externalId}, skipping resubmission`);
        return { success: true, externalOrderId: order.externalId };
      }

      if (order.status !== 'NEW') {
        throw new OrderValidationFailedException(`Order status must be NEW, current: ${order.status}`);
      }
      const isExit = ['EXIT', 'REDUCE', 'CLOSE'].includes(String(order.meta?.intent ?? ''));
      const readiness = SystemReadinessService.getInstance();
      const readinessReport = readiness.report();
      if ((!isExit && !readiness.canCreateNewEntry()) || (isExit && readinessReport.phase !== 'SYSTEM_READY')) {
        throw new RiskLimitExceededException(
          `Trading system not ready: phase=${readinessReport.phase}; reason=${readinessReport.reason}`,
        );
      }

      this.logger.log(`Submitting order ${orderId} to exchange ${order.exchange}`);
      assertExecutionAllowed(order.exchange, undefined, readiness, isExit);

      // ═══════════════════════════════════════════════════════════
      // SAFETY CHECK 1: Verify minimum account balance
      // ═══════════════════════════════════════════════════════════
      const riskConfig = this.getRiskConfiguration();
      const minBalance = riskConfig.minAccountBalanceUsd;
      const userBalance = await this.balanceSyncService.getPortfolioBalance(
        order.userId,
        order.exchange,
      );
      if (userBalance < minBalance) {
        throw new RiskLimitExceededException(
          `Account balance $${userBalance} below minimum $${minBalance}`,
        );
      }

      // ═══════════════════════════════════════════════════════════
      // SAFETY CHECK 2: Verify maximum order value
      // ═══════════════════════════════════════════════════════════
      const maxOrderValue = riskConfig.maxOrderValueUsd;
      const orderValue = order.quantity * (order.price || 0);
      if (orderValue > maxOrderValue) {
        throw new RiskLimitExceededException(
          `Order value $${orderValue.toFixed(2)} exceeds maximum $${maxOrderValue}`,
        );
      }

      // ═══════════════════════════════════════════════════════════
      // SAFETY CHECK 3: Check daily loss limit
      // ═══════════════════════════════════════════════════════════
      const dailyLossLimit = riskConfig.dailyLossLimitUsd;
      const dailyRealizedPnL = await this.pnlCalculationService.calculateDailyRealizedPnL(
        order.userId,
        new Date(),
        process.env.TRADING_TIMEZONE || 'UTC',
      );
      if (dailyRealizedPnL < -dailyLossLimit) {
        this.logger.warn(
          `User ${order.userId} hit daily loss limit: $${dailyRealizedPnL}`,
        );
        throw new RiskLimitExceededException(
          `Daily loss limit reached: $${dailyLossLimit}. Current loss: $${dailyRealizedPnL}`,
        );
      }

      // ═══════════════════════════════════════════════════════════
      // SAFETY CHECK 4: Verify maximum position size
      // ═══════════════════════════════════════════════════════════
      const maxPositionPercent = riskConfig.maxPositionSizePercent;
      const positionPercent = (orderValue / userBalance) * 100;
      if (positionPercent > maxPositionPercent) {
        throw new RiskLimitExceededException(
          `Position size ${positionPercent.toFixed(2)}% exceeds maximum ${maxPositionPercent}%`,
        );
      }

      // ═══════════════════════════════════════════════════════════
      // SAFETY CHECK 5: Check maximum concurrent positions
      // ═══════════════════════════════════════════════════════════
      const maxConcurrentPositions = riskConfig.maxConcurrentPositions;
      const openPositions = await this.positionService.getOpenPositions(order.userId);
      if (!isExit && (openPositions?.length || 0) >= maxConcurrentPositions) {
        throw new RiskLimitExceededException(
          `Maximum concurrent positions (${maxConcurrentPositions}) already open`,
        );
      }

      this.logger.log(
        `Safety checks passed for order ${orderId}. Value: $${orderValue}, Balance: $${userBalance}`,
      );

      const marketMeta = order.meta as Record<string, unknown> | null | undefined;
      const requiredMarketMetrics = ['spread', 'liquidity', 'slippage', 'volatility'];
      for (const metric of requiredMarketMetrics) {
        const value = marketMeta?.[metric];
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new RiskLimitExceededException(`Authoritative market ${metric} is required before exchange submission`);
        }
      }
      if (marketMeta?.stale !== false) {
        throw new RiskLimitExceededException('Authoritative market data is missing or stale');
      }

      const riskEngine = new RiskEngine();
      const riskDecision = riskEngine.evaluate({
        trade: {
          decisionId: orderId,
          symbol: order.symbol,
          action: order.side === 'BUY' ? 'BUY' : 'SELL',
          intent: order.meta?.intent,
          positionId: order.meta?.positionId,
          entry: Number(order.price || 0),
          stopLoss: Number(order.meta?.stopLoss || order.price || 0),
          takeProfit: Number(order.meta?.targetPrice || order.price || 0),
          requestedPositionSize: Number(order.quantity || 0),
          riskAmount: Math.abs(Number(order.price || 0) - Number(order.meta?.stopLoss || order.price || 0)) * Number(order.quantity || 0),
          portfolioHeatBefore: Number(order.meta?.portfolioHeatBefore || 0),
          symbolExposureBefore: Number(order.meta?.symbolExposureBefore || 0),
          correlatedExposureBefore: Number(order.meta?.correlatedExposureBefore || 0),
          leverage: Number(order.meta?.leverage || 1),
          marginRequired: Number(order.quantity || 0) * Number(order.price || 0),
          estimatedFees: Number(order.meta?.fees || 0),
          estimatedSlippage: Number(order.meta?.slippage || 0),
          dailyPnL: Number(order.meta?.dailyPnL || 0),
          dailyLossLimit: riskConfig.dailyLossLimitUsd,
          drawdown: Number(order.meta?.drawdown || 0),
        },
        account: {
          totalEquity: Number(userBalance || 0),
          availableBalance: Number(userBalance || 0),
          marginUsed: 0,
          freeMargin: Number(userBalance || 0),
          unrealizedPnL: 0,
          realizedPnL: Number(dailyRealizedPnL || 0),
          leverage: 1,
          peakEquity: Number(userBalance || 0),
          currentDrawdown: Number(order.meta?.drawdown || 0),
          dailyPnL: Number(dailyRealizedPnL || 0),
          weeklyPnL: Number(dailyRealizedPnL || 0),
          consecutiveLosses: 0,
          tradingEnabled: true,
          killSwitch: process.env.KILL_SWITCH_ACTIVE === 'true',
        },
        positions: (await this.positionService.getOpenPositions(order.userId) || []).map((p: any) => ({
          symbol: p.symbol,
          side: p.side === 'BUY' ? 'long' : 'short',
          quantity: Number(p.quantity || 0),
          entryPrice: Number(p.entryPrice || 0),
          notional: Number(p.quantity || 0) * Number(p.entryPrice || 0),
          exposure: Number(p.quantity || 0) * Number(p.entryPrice || 0),
        })),
        market: {
          spread: marketMeta.spread as number,
          liquidity: marketMeta.liquidity as number,
          slippage: marketMeta.slippage as number,
          stale: false,
          volatility: marketMeta.volatility as number,
        },
      });

      if (!riskDecision.approved) {
        throw new RiskLimitExceededException(`Risk engine rejected order: ${riskDecision.failedChecks.join(', ') || riskDecision.reason}`);
      }

      // Get exchange adapter (in production, this would come from dependency injection)
      const { createExchange } = await import('@rfsanz/exchange');
      
      const account = await this.resolveExecutionAccount(order.user!.id, order.exchange);

      assertExecutionAllowed(order.exchange, account, readiness, isExit);
      exchangeAdapter = createExchange(order.exchange as any, account);
      await exchangeAdapter.connect(account);
      this.wireExchangeAdapter(exchangeAdapter);

      // Validate and fix order parameters (PHASE 1: LOT_SIZE, MIN_NOTIONAL, PRICE_FILTER)
      const orderParams: import('@rfsanz/exchange').OrderParams = {
        symbol: order.symbol,
        side: order.side.toLowerCase() as 'buy' | 'sell',
        type: isExit ? 'market' : 'limit',
        quantity: order.quantity.toString(),
        price: isExit ? undefined : order.price?.toString(),
        clientOrderId: buildCanonicalClientOrderId(order.id),
        intent: order.meta?.intent,
        positionId: order.meta?.positionId,
        timeInForce: 'GTC',
      };
      await prisma.order.update({
        where: { id: orderId },
        data: {
          meta: { ...(order.meta as Record<string, unknown> ?? {}), clientOrderId: orderParams.clientOrderId },
        },
      });

      // Validate against symbol filters
      const validatedParams = await this.symbolValidator.validateAndFixOrderParams(
        exchangeAdapter,
        order.symbol,
        orderParams,
      );
      const normalizedSymbolInfo = await this.symbolValidator.getExchangeSymbolInfo(
        exchangeAdapter,
        order.symbol,
      );
      const normalizedMeta = {
        ...(order.meta as Record<string, unknown> ?? {}),
        clientOrderId: validatedParams.clientOrderId,
        ...(normalizedSymbolInfo ? {
          stopLoss: this.symbolValidator.normalizeProtectionPrice(
            order.meta?.stopLoss === undefined ? undefined : Number(order.meta.stopLoss),
            normalizedSymbolInfo,
            order.side as 'BUY' | 'SELL',
            'stop',
          ),
          targetPrice: this.symbolValidator.normalizeProtectionPrice(
            order.meta?.targetPrice === undefined ? undefined : Number(order.meta.targetPrice),
            normalizedSymbolInfo,
            order.side as 'BUY' | 'SELL',
            'target',
          ),
        } : {}),
      } as Record<string, any>;
      assertLiveEntryProtectionReady(
        account.tradingMode,
        isExit,
        {
          nativeStopLossTakeProfit: Boolean(
            (exchangeAdapter as any).nativeProtectionVerified === true
            &&
            typeof (exchangeAdapter as any).createProtectionOco === 'function'
            && typeof (exchangeAdapter as any).cancelProtectionOrder === 'function'
            && typeof (exchangeAdapter as any).getProtectionOrder === 'function',
          ),
        },
      );
      pendingClientOrderId = validatedParams.clientOrderId;
      pendingSymbol = order.symbol;
      await prisma.order.update({
        where: { id: orderId },
        data: {
          meta: {
            ...normalizedMeta,
            submissionState: 'SUBMITTING',
            submissionStartedAt: new Date().toISOString(),
          },
        },
      });
      await prisma.order.update({
        where: { id: orderId },
        data: {
          price: validatedParams.price === undefined ? order.price : Number(validatedParams.price),
          meta: normalizedMeta,
        },
      });

      const normalizedRiskDecision = new RiskEngine().evaluate({
        trade: {
          decisionId: orderId,
          symbol: order.symbol,
          action: order.side === 'BUY' ? 'BUY' : 'SELL',
          intent: normalizedMeta.intent as any,
          positionId: normalizedMeta.positionId as string | undefined,
          entry: Number(validatedParams.price ?? order.price ?? 0),
          stopLoss: Number(normalizedMeta.stopLoss ?? validatedParams.price ?? order.price ?? 0),
          takeProfit: Number(normalizedMeta.targetPrice ?? validatedParams.price ?? order.price ?? 0),
          requestedPositionSize: Number(validatedParams.quantity || 0),
          riskAmount: Math.abs(
            Number(validatedParams.price ?? order.price ?? 0)
            - Number(normalizedMeta.stopLoss ?? validatedParams.price ?? order.price ?? 0),
          ) * Number(validatedParams.quantity || 0),
          portfolioHeatBefore: Number(normalizedMeta.portfolioHeatBefore || 0),
          symbolExposureBefore: Number(normalizedMeta.symbolExposureBefore || 0),
          correlatedExposureBefore: Number(normalizedMeta.correlatedExposureBefore || 0),
          leverage: Number(normalizedMeta.leverage || 1),
          marginRequired: Number(validatedParams.quantity || 0) * Number(validatedParams.price ?? order.price ?? 0),
          estimatedFees: Number(normalizedMeta.fees || 0),
          estimatedSlippage: Number(normalizedMeta.slippage || 0),
          dailyPnL: Number(normalizedMeta.dailyPnL || 0),
          dailyLossLimit: riskConfig.dailyLossLimitUsd,
          drawdown: Number(normalizedMeta.drawdown || 0),
        },
        account: {
          totalEquity: Number(userBalance || 0),
          availableBalance: Number(userBalance || 0),
          marginUsed: 0,
          freeMargin: Number(userBalance || 0),
          unrealizedPnL: 0,
          realizedPnL: Number(dailyRealizedPnL || 0),
          leverage: 1,
          peakEquity: Number(userBalance || 0),
          currentDrawdown: Number(normalizedMeta.drawdown || 0),
          dailyPnL: Number(dailyRealizedPnL || 0),
          weeklyPnL: Number(dailyRealizedPnL || 0),
          consecutiveLosses: 0,
          tradingEnabled: true,
          killSwitch: process.env.KILL_SWITCH_ACTIVE === 'true',
        },
        positions: (await this.positionService.getOpenPositions(order.userId) || []).map((p: any) => ({
          symbol: p.symbol,
          side: p.side === 'BUY' ? 'long' : 'short',
          quantity: Number(p.quantity || 0),
          entryPrice: Number(p.entryPrice || 0),
          notional: Number(p.quantity || 0) * Number(p.entryPrice || 0),
          exposure: Number(p.quantity || 0) * Number(p.entryPrice || 0),
        })),
        market: {
          spread: normalizedMeta.spread as number,
          liquidity: normalizedMeta.liquidity as number,
          slippage: normalizedMeta.slippage as number,
          stale: normalizedMeta.stale === false ? false : true,
          volatility: normalizedMeta.volatility as number,
        },
      });
      if (!normalizedRiskDecision.approved) {
        throw new RiskLimitExceededException(
          `Risk engine rejected normalized order: ${normalizedRiskDecision.failedChecks.join(', ') || normalizedRiskDecision.reason}`,
        );
      }

      const authorization = authorizationService.issueFromDecision(normalizedRiskDecision, {
        mode: account.tradingMode,
        accountId: account.id,
        symbol: order.symbol,
        side: order.side === 'BUY' ? 'BUY' : 'SELL',
        quantity: Number(validatedParams.quantity || 0),
        intent: order.meta?.intent,
        positionId: order.meta?.positionId,
      });

      // All exchange submission is delegated to the canonical OrderService boundary.
      const exchangeOrder = await orderService.place(
        account.id,
        order.exchange as any,
        validatedParams,
        orderId,
        authorization,
        account,
      );

      // Store external order ID
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          status: ['FILLED', 'PARTIALLY_FILLED'].includes(exchangeOrder.status)
            ? exchangeOrder.status as any
            : 'NEW',
          filled: Number(order.filled || 0),
          externalId: exchangeOrder.externalId || exchangeOrder.id,
          meta: {
            ...normalizedMeta,
            externalOrderId: exchangeOrder.externalId || exchangeOrder.id,
            clientOrderId: exchangeOrder.clientOrderId,
            submittedAt: new Date().toISOString(),
            exchangeResponse: {
              price: exchangeOrder.price,
              quantity: exchangeOrder.quantity,
              filled: exchangeOrder.filled,
              status: exchangeOrder.status,
            },
            submissionState: 'CONFIRMED',
          },
        },
      });

      // Publish event
      const event = new OrderSubmittedToExchangeEvent(
        orderId,
        order.userId,
        order.exchange,
        exchangeOrder.externalId || exchangeOrder.id,
        order.symbol,
        order.side as any,
        order.quantity,
        order.price || 0,
      );
      await this.eventEmitter.emitAsync(EVENT_NAMES.orderSubmitted, event);

      this.logger.log(
        `Order submitted to ${order.exchange}: internal=${orderId}, external=${exchangeOrder.externalId || exchangeOrder.id}`,
      );

      return { success: true, externalOrderId: exchangeOrder.externalId || exchangeOrder.id };
    } catch (error) {
      if (error instanceof Error && /protection|unprotected/i.test(error.message)) {
        await setKillSwitch(true, `Protection failure during order ${orderId}`);
      }
      if (exchangeAdapter && pendingClientOrderId && pendingSymbol) {
        try {
          const reconciled = await exchangeAdapter.getOrder(pendingClientOrderId, pendingSymbol);
          if (reconciled) {
            const externalOrderId = reconciled.externalId || reconciled.id;
            const status = String(reconciled.status).toUpperCase();
            await prisma.order.update({
              where: { id: orderId },
              data: {
                status: status === 'REJECTED' ? 'REJECTED' : status === 'CANCELED' ? 'CANCELED' : status === 'PARTIALLY_FILLED' ? 'PARTIALLY_FILLED' : 'NEW',
                externalId: externalOrderId,
                meta: {
                  ...(((await prisma.order.findUnique({ where: { id: orderId }, select: { meta: true } }))?.meta as Record<string, unknown> | null | undefined) ?? {}),
                  externalOrderId,
                  clientOrderId: reconciled.clientOrderId ?? pendingClientOrderId,
                  submissionState: 'CONFIRMED',
                  reconciledAfterSubmissionError: true,
                },
              },
            });
            if (status !== 'REJECTED' && status !== 'CANCELED') {
              return { success: true, externalOrderId };
            }
          } else {
            const current = await prisma.order.findUnique({ where: { id: orderId }, select: { meta: true } });
            await prisma.order.update({
              where: { id: orderId },
              data: {
                meta: {
                  ...((current?.meta as Record<string, unknown> | null | undefined) ?? {}),
                  submissionState: 'UNKNOWN',
                  submissionError: 'Exchange submission outcome could not be determined',
                },
              },
            });
          }
        } catch (reconciliationError) {
          this.logger.error(
            `Unable to reconcile ambiguous submission for ${orderId}: ${reconciliationError instanceof Error ? reconciliationError.message : String(reconciliationError)}`,
          );
        }
      }
      this.logger.error(
        `Failed to submit order to exchange: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : '',
      );

      // Publish failure event
      const order = await prisma.order
        .findUnique({ where: { id: orderId } })
        .catch(() => null);
      if (order) {
        const failEvent = new OrderFailedEvent(
          orderId,
          order.userId,
          order.symbol,
          error instanceof Error ? error.message : String(error),
        );
        await this.eventEmitter
          .emitAsync(EVENT_NAMES.orderFailed, failEvent)
          .catch(() => {});
      }

      throw error;
    } finally {
      // Clean up exchange adapter connection
      if (exchangeAdapter) {
        try {
          await exchangeAdapter.disconnect();
        } catch (error) {
          this.logger.warn(
            `Error disconnecting from exchange: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  /**
   * Record trade execution
   */
  async recordTrade(params: {
    orderId: string;
    executionConfirmation: TrustedExecutionConfirmation;
  }): Promise<string> {
    try {
      const order = await prisma.order.findUnique({
        where: { id: params.orderId },
        include: {
          user: {
            include: {
              exchangeAccounts: { where: { isActive: true } },
            },
          },
        },
      });

      if (!order) {
        throw new OrderNotFoundException(params.orderId);
      }
      const exchangeAccount = process.env.TRADING_MODE === 'TESTNET'
        ? await resolveCanonicalTestnetAccount(order.userId)
        : order.user?.exchangeAccounts?.find((account: any) => account.exchange === order.exchange);
      if (!exchangeAccount || !order.externalId || !executionConfirmationService.verify(params.executionConfirmation, {
        orderId: order.id,
        decisionId: order.id,
        externalOrderId: order.externalId,
        accountId: exchangeAccount.id,
        exchange: order.exchange,
        symbol: order.symbol,
        side: order.side as 'BUY' | 'SELL',
        quantity: Number(order.quantity),
      })) {
        throw new OrderValidationFailedException(
          'Trade recording requires a trusted exchange-authoritative execution confirmation',
        );
      }

      const alreadyFilled = Number(order.filled || 0);
      const newFilled = params.executionConfirmation.cumulativeExecutedQuantity;
      const fillQuantity = calculateFillDelta(newFilled, alreadyFilled);
      if (fillQuantity <= 0) {
        const executionKey = `${order.exchange}:${exchangeAccount.id}:${params.executionConfirmation.externalOrderId}:${params.executionConfirmation.exchangeTradeId}`;
        const existingTrade = await prisma.trade.findFirst({
          where: { OR: [{ executionKey }, { exchangeTradeId: params.executionConfirmation.exchangeTradeId }] },
        });
        if (existingTrade) {
          return existingTrade.id;
        }
        throw new OrderValidationFailedException('Execution confirmation contains no new executed quantity');
      }
      const status = params.executionConfirmation.status;

      // Create trade record
      const trade = await prisma.trade.create({
        data: {
          orderId: params.orderId,
          exchange: order.exchange,
          exchangeAccountId: exchangeAccount.id,
          exchangeOrderId: params.executionConfirmation.externalOrderId,
          exchangeTradeId: params.executionConfirmation.exchangeTradeId,
          executionKey: `${order.exchange}:${exchangeAccount.id}:${params.executionConfirmation.externalOrderId}:${params.executionConfirmation.exchangeTradeId}`,
          price: params.executionConfirmation.averageExecutionPrice,
          quantity: fillQuantity,
          fee: params.executionConfirmation.fees,
          side: order.side as any,
          exchangeTimestamp: new Date(),
        },
      });

      // Update order status
      await prisma.order.update({
        where: { id: params.orderId },
        data: {
          filled: newFilled,
          status,
        },
      });

      // Publish events
      const tradeEvent = new TradeRecordedEvent(
        trade.id,
        params.orderId,
        order.userId,
        order.symbol,
        order.side as any,
        fillQuantity,
        params.executionConfirmation.averageExecutionPrice,
        params.executionConfirmation.fees,
      );
      await this.eventEmitter.emitAsync(EVENT_NAMES.tradeRecorded, tradeEvent);

      // Update position
      await this.updatePosition(
        order.userId,
        order.symbol,
        order.side as 'BUY' | 'SELL',
        fillQuantity,
        params.executionConfirmation.averageExecutionPrice,
        params.executionConfirmation.fees,
      );

      this.logger.log(`Trade recorded: ${trade.id} for order ${params.orderId}`);
      return trade.id;
    } catch (error) {
      this.logger.error(`Failed to record trade: ${error.message}`, error.stack);
      throw error;
    }
  }

  async verifyExecution(orderId: string): Promise<TrustedExecutionConfirmation> {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: {
            include: {
              exchangeAccounts: {
                where: { isActive: true },
                include: { apiKeys: { where: { revoked: false } } },
              },
            },
          },
        },
      }) as any;
      if (!order || !order.externalId) throw new OrderValidationFailedException('Order has no exchange identity');
      const exchangeAccount = process.env.TRADING_MODE === 'TESTNET'
        ? await resolveCanonicalTestnetAccount(order.userId)
        : order.user?.exchangeAccounts?.find((account: any) => account.exchange === order.exchange);
      if (!exchangeAccount) throw new OrderValidationFailedException('No active exchange account found');
      const account = process.env.TRADING_MODE === 'TESTNET'
        ? exchangeAccount
        : {
          id: exchangeAccount.id,
          userId: order.user.id,
          exchange: order.exchange,
          accountId: exchangeAccount.accountId,
          credentials: this.resolveExchangeCredentials(exchangeAccount.apiKeys, order.exchange),
          isActive: exchangeAccount.isActive,
          isPaper: process.env.TRADING_MODE === 'PAPER',
          tradingMode: process.env.TRADING_MODE as 'PAPER' | 'LIVE',
        };
      assertExecutionAllowed(order.exchange, account);
      const { createExchange } = await import('@rfsanz/exchange');
      const adapter = createExchange(order.exchange as any, account);
      await adapter.connect(account);
      try {
        const exchangeOrder = await adapter.getOrder(order.externalId, order.symbol);
        if (!exchangeOrder) throw new OrderValidationFailedException('Exchange order was not found');
        return executionConfirmationService.fromExchangeOrder({
          orderId: order.id,
          decisionId: order.id,
          externalOrderId: order.externalId,
          account,
          symbol: order.symbol,
          side: order.side as 'BUY' | 'SELL',
          quantity: Number(order.quantity),
        }, exchangeOrder, 'EXCHANGE_QUERY');
      } finally {
        await adapter.disconnect();
    }
  }

  /**
   * Update position after trade
   */
  private async updatePosition(
    userId: string,
    symbol: string,
    side: 'BUY' | 'SELL',
    quantity: number,
    price: number,
    fee = 0,
  ): Promise<void> {
    try {
      // Find or create position
      let position: any = await prisma.position.findFirst({
        where: {
          userId,
          symbol,
          status: 'OPEN',
        },
      });

      if (!position) {
        // Create new position
        position = await prisma.position.create({
          data: {
            userId,
            symbol,
            side,
            quantity,
            entryPrice: price,
            status: 'OPEN',
          },
        });
      } else {
        // Update existing position
        if (side === position.side) {
          // Same direction: increase position
          const newQuantity = position.quantity + quantity;
          const newEntryPrice = (position.quantity * position.entryPrice + quantity * price) / newQuantity;

          position = await prisma.position.update({
            where: { id: position.id },
            data: {
              quantity: newQuantity,
              entryPrice: newEntryPrice,
            },
          });
        } else {
          // Opposite direction: decrease or close position
          const newQuantity = position.quantity - quantity;

          if (newQuantity <= 0) {
            // Close position
            position = await prisma.position.update({
              where: { id: position.id },
              data: {
                quantity: 0,
                status: 'CLOSED',
                closedAt: new Date(),
                realizedPnL: Number(position.realizedPnL ?? 0)
                  + calculateDirectionalPnL(
                    Number(position.entryPrice),
                    price,
                    Math.min(quantity, Number(position.quantity)),
                    position.side as 'BUY' | 'SELL',
                    fee,
                  ),
              },
            });
          } else {
            // Partial close
            position = await prisma.position.update({
              where: { id: position.id },
              data: {
                quantity: newQuantity,
                realizedPnL: Number(position.realizedPnL ?? 0)
                  + calculateDirectionalPnL(
                    Number(position.entryPrice),
                    price,
                    quantity,
                    position.side as 'BUY' | 'SELL',
                    fee,
                  ),
              },
            });
          }
        }
      }

      // Publish position updated event
      const event = new PositionUpdatedEvent(
        position.id,
        userId,
        symbol,
        side,
        position.quantity,
        position.entryPrice,
      );
      await this.eventEmitter.emitAsync(EVENT_NAMES.positionUpdated, event);

      this.logger.log(`Position updated: ${symbol} ${side} ${position.quantity} units`);
    } catch (error) {
      this.logger.error(`Failed to update position: ${error.message}`, error.stack);
    }
  }

  /**
   * Get order by ID
   */
  async getOrder(orderId: string): Promise<any> {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        trades: true,
        analysisLinks: true,
      },
    });

    if (!order) {
      throw new OrderNotFoundException(orderId);
    }

    return order;
  }

  /**
   * Validate order
   */
  private validateOrder(params: any): void {
    if (!params.symbol || params.symbol.trim().length === 0) {
      throw new OrderCreationFailedException('Symbol is required');
    }

    if (!['BUY', 'SELL'].includes(params.side)) {
      throw new OrderCreationFailedException('Invalid side: must be BUY or SELL');
    }

    if (params.quantity <= 0) {
      throw new OrderCreationFailedException('Quantity must be greater than 0');
    }

    if (params.price <= 0) {
      throw new OrderCreationFailedException('Price must be greater than 0');
    }
  }

  /**
   * Sync order status from exchange
   * PHASE 1: Order status tracking
   */
  async syncOrderStatus(orderId: string): Promise<void> {
    let exchangeAdapter: any = null;

    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: {
            include: {
              exchangeAccounts: {
                where: { isActive: true },
                include: {
                  apiKeys: {
                    where: { revoked: false },
                  },
                },
              },
            },
          },
        },
      });

      if (!order) {
        throw new OrderNotFoundException(orderId);
      }

      if (!order.externalId) {
        this.logger.warn(`Order ${orderId} has no external ID, skipping sync`);
        return;
      }

      const account = await this.resolveExecutionAccount(order.user!.id, order.exchange);

      assertExecutionAllowed(order.exchange, account);
      const { createExchange } = await import('@rfsanz/exchange');
      exchangeAdapter = createExchange(order.exchange as any, account);
      await exchangeAdapter.connect(account);

      // Get order status from exchange
      const exchangeOrder = await exchangeAdapter.getOrder(order.externalId, order.symbol);

      if (!exchangeOrder) {
        this.logger.warn(`Order ${order.externalId} not found on exchange`);
        return;
      }

      // Update order with exchange status
      await this.updateOrderFromExchange(order, exchangeOrder);
    } catch (error) {
      this.logger.error(
        `Failed to sync order status: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : '',
      );
    } finally {
      if (exchangeAdapter) {
        try {
          await exchangeAdapter.disconnect();
        } catch (error) {
          this.logger.warn(
            `Error disconnecting from exchange: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  /**
   * Update local order from exchange order data
   */
  private async updateOrderFromExchange(localOrder: any, exchangeOrder: any): Promise<void> {
    const statusMap: Record<string, string> = {
      NEW: 'PENDING',
      PARTIALLY_FILLED: 'PARTIALLY_FILLED',
      FILLED: 'FILLED',
      CANCELED: 'CANCELED',
      REJECTED: 'REJECTED',
      EXPIRED: 'CANCELED',
    };

    const mappedStatus = statusMap[exchangeOrder.status] || exchangeOrder.status;

    // Check if order has been partially or fully filled
    const previousFilled = localOrder.filled || 0;
    const currentFilled = parseFloat(exchangeOrder.filled);
    const newlyFilled = currentFilled - previousFilled;

    if (newlyFilled > 0) {
      const executionAccountId = process.env.TRADING_MODE === 'TESTNET'
        ? (await resolveCanonicalTestnetAccount(localOrder.userId)).id
        : localOrder.user?.exchangeAccounts?.find((account: any) => account.exchange === localOrder.exchange)?.id ?? '';
      // Record partial/full fill
      await this.recordTrade({
        orderId: localOrder.id,
        executionConfirmation: executionConfirmationService.fromExchangeOrder({
          orderId: localOrder.id,
          decisionId: localOrder.id,
          externalOrderId: String(exchangeOrder.externalId || exchangeOrder.id),
          account: {
            id: executionAccountId,
            userId: localOrder.userId,
            exchange: localOrder.exchange,
            isActive: true,
            tradingMode: process.env.TRADING_MODE as 'PAPER' | 'TESTNET' | 'LIVE',
          },
          symbol: localOrder.symbol,
          side: localOrder.side as 'BUY' | 'SELL',
          quantity: Number(localOrder.quantity),
        }, exchangeOrder),
      });
    }

    // Update order status if changed
    if (mappedStatus !== localOrder.status) {
      await prisma.order.update({
        where: { id: localOrder.id },
        data: {
          status: mappedStatus,
          filled: currentFilled,
          meta: {
            ...localOrder.meta,
            lastSyncedAt: new Date().toISOString(),
            exchangeStatus: exchangeOrder.status,
          },
        },
      });

      this.logger.log(
        `Order ${localOrder.id} status changed from ${localOrder.status} to ${mappedStatus}`,
      );
    }
  }

  /**
   * Reconcile all open orders with exchange
   * PHASE 1: Startup reconciliation
   * Called at application startup to repair any inconsistencies between local and exchange state
   */
  async reconcileOpenOrders(userId: string, exchange: string): Promise<void> {
    let exchangeAdapter: any = null;

    try {
      this.logger.log(`Starting reconciliation for ${exchange} user ${userId}`);

      const account = await this.resolveExecutionAccount(userId, exchange);

      // Get all open orders from database
      const dbOpenOrders: any[] = await prisma.order.findMany({
        where: {
          userId,
          exchange,
          status: { in: ['PARTIALLY_FILLED', 'NEW'] },
        },
      });

      // Connect to exchange only after the local reconciliation scope is known.
      const { createExchange } = await import('@rfsanz/exchange');
      exchangeAdapter = createExchange(exchange as any, account);
      await exchangeAdapter.connect(account);

      // Get all open orders from exchange
      const exchangeOpenOrders = await exchangeAdapter.fetchOpenOrders();

      // Build maps for comparison
      const exchangeOrdersMap = new Map(
        exchangeOpenOrders.map((o) => [o.externalId || o.id, o]),
      );
      const dbOrdersMap = new Map(dbOpenOrders.map((o) => [o.externalId, o]));

      // Update database orders to match exchange state
      for (const dbOrder of dbOpenOrders) {
        const exchangeOrder = dbOrder.externalId 
          ? exchangeOrdersMap.get(dbOrder.externalId)
          : null;

        if (exchangeOrder) {
          // Order exists on exchange, sync status
          await this.updateOrderFromExchange(dbOrder, exchangeOrder);
        } else {
          const terminalOrder = dbOrder.externalId
            ? await exchangeAdapter.getOrder(dbOrder.externalId, dbOrder.symbol)
            : null;
          if (terminalOrder) {
            await this.updateOrderFromExchange(dbOrder, terminalOrder);
          } else {
            if (
              dbOrder.status === 'NEW'
              && !dbOrder.externalId
              && Number(dbOrder.filled ?? 0) === 0
            ) {
              await prisma.$transaction(async (tx) => {
                const current = await tx.order.findUnique({ where: { id: dbOrder.id } });
                if (!current || current.userId !== userId) {
                  throw new Error('Reconciliation order ownership changed');
                }
                if (
                  current.status !== 'NEW'
                  || current.externalId
                  || Number(current.filled ?? 0) !== 0
                ) {
                  return;
                }

                const evidence = {
                  ...(current.meta as Record<string, unknown> | null ?? {}),
                  reconciliation: {
                    ...((
                      current.meta as Record<string, unknown> | null | undefined
                    )?.reconciliation as Record<string, unknown> | undefined ?? {}),
                    resolvedAt: new Date().toISOString(),
                    resolution: 'REJECTED',
                    reason: 'LOCAL_NEW_ORDER_NOT_ACCEPTED_BY_EXCHANGE',
                    exchangeMatch: 'NONE',
                    externalId: null,
                    filled: 0,
                  },
                };

                await tx.order.update({
                  where: { id: current.id },
                  data: { status: 'REJECTED', meta: evidence },
                });
                await tx.auditLog.create({
                  data: {
                    userId,
                    action: 'ORDER_RECONCILIATION_REJECTED',
                    resource: current.id,
                    meta: {
                      reason: 'LOCAL_NEW_ORDER_NOT_ACCEPTED_BY_EXCHANGE',
                      exchange: current.exchange,
                      symbol: current.symbol,
                      externalId: null,
                      filled: 0,
                    },
                  },
                });
              });
              this.logger.warn(
                `Order ${dbOrder.id} resolved as REJECTED: local NEW order was not accepted by exchange`,
              );
            } else {
              this.logger.warn(
                `Order ${dbOrder.id} is absent from open and terminal exchange queries; leaving local state unchanged`,
              );
            }
          }
        }
      }

      this.logger.log(
        `Reconciliation complete for ${exchange} user ${userId}: ${dbOpenOrders.length} orders checked`,
      );
    } catch (error) {
      this.logger.error(
        `Failed to reconcile orders: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : '',
      );
    } finally {
      if (exchangeAdapter) {
        try {
          await exchangeAdapter.disconnect();
        } catch (error) {
          this.logger.warn(
            `Error disconnecting from exchange: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  /**
   * Cancel order on exchange
   * PHASE 1: Cancellation handling
   */
  async cancelOrder(orderId: string): Promise<{ success: boolean; message: string }> {
    let exchangeAdapter: any = null;

    try {
      const order = await prisma.order.findUnique({
        where: { id: orderId },
        include: {
          user: {
            include: {
              exchangeAccounts: {
                where: { isActive: true },
                include: {
                  apiKeys: {
                    where: { revoked: false },
                  },
                },
              },
            },
          },
        },
      });

      if (!order) {
        throw new OrderNotFoundException(orderId);
      }

      // Only cancel orders that are not already in final state
      if (['FILLED', 'CANCELED', 'REJECTED'].includes(order.status)) {
        throw new OrderValidationFailedException(
          `Cannot cancel order in ${order.status} status`,
        );
      }

      if (!order.externalId) {
        throw new OrderValidationFailedException(
          `Order has no external ID, cannot cancel on exchange`,
        );
      }

      this.logger.log(`Canceling order ${orderId} (external: ${order.externalId})`);

      // Get exchange adapter
      const { createExchange } = await import('@rfsanz/exchange');
      const account = await this.resolveExecutionAccount(order.user!.id, order.exchange);

      assertExecutionAllowed(order.exchange, account);
      await orderService.cancel(
        account.id,
        order.exchange as any,
        order.externalId,
        account,
      );

      // Update order status
      const updatedOrder = await prisma.order.update({
        where: { id: orderId },
        data: {
          status: 'CANCELED',
          meta: {
            ...(order.meta as Record<string, unknown>),
            canceledAt: new Date().toISOString(),
            cancelReason: 'User initiated cancellation',
          },
        },
      });

      this.logger.log(`Order ${orderId} successfully canceled on ${order.exchange}`);

      return {
        success: true,
        message: `Order ${orderId} has been canceled`,
      };
    } catch (error) {
      this.logger.error(
        `Failed to cancel order: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : '',
      );

      // Publish cancellation failure event
      const order = await prisma.order
        .findUnique({ where: { id: orderId } })
        .catch(() => null);
      if (order) {
        const failEvent = new OrderFailedEvent(
          orderId,
          order.userId,
          order.symbol,
          `Cancellation failed: ${error instanceof Error ? error.message : String(error)}`,
        );
        await this.eventEmitter
          .emitAsync(EVENT_NAMES.orderFailed, failEvent)
          .catch(() => {});
      }

      throw error;
    } finally {
      if (exchangeAdapter) {
        try {
          await exchangeAdapter.disconnect();
        } catch (error) {
          this.logger.warn(
            `Error disconnecting from exchange: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }
  }

  /**
   * Get recommendation's alert
   */
  private async getRecommendationAlert(recommendationId: string, userId: string): Promise<any> {
    const recommendation = await prisma.recommendation.findUnique({
      where: { id: recommendationId },
    });

    if (!recommendation || recommendation.userId !== userId) {
      throw new OrderCreationFailedException(`Recommendation ${recommendationId} is not accessible`);
    }

    return { id: recommendation.alertId };
  }

  /**
   * PHASE 2: Sync balances from exchange and store in history
   */
  async syncUserBalances(userId: string, exchange: string): Promise<any> {
    let exchangeAdapter: any = null;

    try {
      this.logger.log(`Syncing balances for user ${userId} on ${exchange}`);

      const account = await this.resolveExecutionAccount(userId, exchange);

      // Connect to exchange
      const { createExchange } = await import('@rfsanz/exchange');
      exchangeAdapter = createExchange(exchange as any, account);
      await exchangeAdapter.connect(account);

      // Sync balances
      const result = await this.balanceSyncService.syncBalances(
        userId,
        exchangeAdapter,
        exchange,
      );

      this.logger.log(`Synced ${result.assets} assets for ${exchange}`);
      return result;
    } catch (error) {
      this.logger.error(
        `Failed to sync balances: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    } finally {
      if (exchangeAdapter) {
        try {
          await exchangeAdapter.disconnect();
        } catch (error) {
          this.logger.warn(`Error disconnecting from exchange: ${error}`);
        }
      }
    }
  }

  /**
   * PHASE 2: Get position metrics (P&L, quantity, etc.)
   */
  async getPositionMetrics(positionId: string): Promise<any> {
    try {
      const position = await prisma.position.findUnique({
        where: { id: positionId },
      });

      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      // For live P&L, would need current market price
      // For now, return stored metrics
      return {
        positionId,
        symbol: position.symbol,
        side: position.side,
        quantity: position.quantity.toNumber(),
        entryPrice: position.entryPrice.toNumber(),
        unrealizedPnL: position.unrealizedPnL?.toNumber() || 0,
        realizedPnL: position.realizedPnL?.toNumber() || 0,
        status: position.status,
        stopLoss: position.stopLoss?.toNumber(),
        takeProfit: position.takeProfit?.toNumber(),
        openedAt: position.openedAt,
        closedAt: position.closedAt,
      };
    } catch (error) {
      this.logger.error(`Failed to get position metrics: ${error}`);
      throw error;
    }
  }

  /**
   * PHASE 2: Get total P&L metrics for user
   */
  async getPnLMetrics(userId: string): Promise<any> {
    try {
      const metrics = await this.pnlCalculationService.calculatePnLMetrics(userId);
      return metrics;
    } catch (error) {
      this.logger.error(`Failed to get P&L metrics: ${error}`);
      throw error;
    }
  }

  /**
   * PHASE 2: Update stop-loss and take-profit for a position
   */
  async updateStopLossTakeProfit(
    positionId: string,
    stopLoss?: number,
    takeProfit?: number,
  ): Promise<void> {
    try {
      const position = await prisma.position.findUnique({
        where: { id: positionId },
      });

      if (!position) {
        throw new Error(`Position ${positionId} not found`);
      }

      if (position.status !== 'OPEN') {
        throw new Error(`Cannot update stop-loss/take-profit for closed position`);
      }

      const normalizedStopLoss = stopLoss === undefined ? undefined : Number(stopLoss);
      const normalizedTakeProfit = takeProfit === undefined ? undefined : Number(takeProfit);
      if (normalizedStopLoss === undefined && normalizedTakeProfit === undefined) {
        throw new Error('At least one of stopLoss or takeProfit must be supplied');
      }

      const mode = (process.env.TRADING_MODE ?? 'TESTNET') as 'PAPER' | 'TESTNET' | 'LIVE';
      const exchangeName = 'binance';
      const account = await this.resolveExecutionAccount(position.userId, exchangeName);
      const { createExchange } = await import('@rfsanz/exchange');
      const adapter = createExchange(exchangeName as any, account);
      const protectionService = new ProtectionOrderService();
      const protectionMeta = ((position.meta as Record<string, unknown> | null | undefined) ?? {}) as Record<string, unknown>;
      const persisted: Record<string, unknown> = {
        ...protectionMeta,
        protectionUpdatedAt: new Date().toISOString(),
      };

      if (adapter && typeof (adapter as any).createProtectionOco === 'function'
        && normalizedStopLoss !== undefined && normalizedTakeProfit !== undefined) {
        const listClientOrderId = `pos-${position.id}-oco`;
        const order = await (adapter as any).createProtectionOco({
          symbol: position.symbol,
          side: position.side === 'BUY' ? 'sell' : 'buy',
          quantity: String(position.quantity),
          stopLossTriggerPrice: String(normalizedStopLoss),
          stopLossLimitPrice: String(normalizedStopLoss),
          takeProfitTriggerPrice: String(normalizedTakeProfit),
          takeProfitLimitPrice: String(normalizedTakeProfit),
          listClientOrderId,
          stopLossClientOrderId: `${listClientOrderId}-sl`,
          takeProfitClientOrderId: `${listClientOrderId}-tp`,
        });
        persisted.protectionState = order.state;
        persisted.protectionListClientOrderId = listClientOrderId;
        persisted.protectionListId = order.externalId ?? order.id;
        persisted.stopLossProtectionClientOrderId = `${listClientOrderId}-sl`;
        persisted.takeProfitProtectionClientOrderId = `${listClientOrderId}-tp`;
      } else if (adapter && typeof (adapter as any).createProtectionOrder === 'function') {
        const submissionIds: string[] = [];
        if (normalizedStopLoss !== undefined) {
          const order = await protectionService.create(adapter as any, {
            symbol: position.symbol,
            side: position.side === 'BUY' ? 'sell' : 'buy',
            quantity: String(position.quantity),
            triggerPrice: String(normalizedStopLoss),
            limitPrice: String(normalizedStopLoss),
            clientOrderId: `pos-${position.id}-sl-${Date.now()}`,
            kind: 'STOP_LOSS',
          });
          submissionIds.push(order.clientOrderId ?? order.externalId ?? order.id);
          persisted.stopLossProtectionState = order.state;
          persisted.stopLossProtectionId = order.externalId ?? order.id;
          persisted.stopLossProtectionClientOrderId = order.clientOrderId ?? order.id;
        }
        if (normalizedTakeProfit !== undefined) {
          const order = await protectionService.create(adapter as any, {
            symbol: position.symbol,
            side: position.side === 'BUY' ? 'sell' : 'buy',
            quantity: String(position.quantity),
            triggerPrice: String(normalizedTakeProfit),
            limitPrice: String(normalizedTakeProfit),
            clientOrderId: `pos-${position.id}-tp-${Date.now()}`,
            kind: 'TAKE_PROFIT',
          });
          submissionIds.push(order.clientOrderId ?? order.externalId ?? order.id);
          persisted.takeProfitProtectionState = order.state;
          persisted.takeProfitProtectionId = order.externalId ?? order.id;
          persisted.takeProfitProtectionClientOrderId = order.clientOrderId ?? order.id;
        }
        persisted.protectionState = submissionIds.length > 0 ? 'CONFIRMED' : 'PENDING';
      } else {
        if (mode === 'LIVE') {
          throw new Error('LIVE protection blocked: exchange-native stop-loss/take-profit protection is unavailable');
        }
        persisted.protectionState = 'PENDING';
      }

      await prisma.position.update({
        where: { id: positionId },
        data: {
          stopLoss: normalizedStopLoss === undefined ? position.stopLoss : normalizedStopLoss,
          takeProfit: normalizedTakeProfit === undefined ? position.takeProfit : normalizedTakeProfit,
          meta: persisted as any,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to update stop-loss/take-profit: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  async requestPositionClose(positionId: string, reason?: string): Promise<{ orderId: string; status: string }> {
      const position = await prisma.position.findUnique({ where: { id: positionId } });
      if (!position || position.status !== 'OPEN') {
        throw new Error(`Position ${positionId} is not open`);
      }
      const positionMeta = (position.meta as Record<string, unknown> | null | undefined) ?? {};
      if (typeof positionMeta.closeOrderId === 'string') {
        throw new Error(`Position ${positionId} already has a close order`);
      }
      const side = position.side === 'BUY' ? 'SELL' : 'BUY';
      const exchange = process.env.TRADING_MODE === 'TESTNET'
        ? 'binance'
        : (await prisma.exchangeAccount.findFirst({
          where: { userId: position.userId, isActive: true },
          select: { exchange: true },
        }))?.exchange ?? 'binance';
      const account = await this.resolveExecutionAccount(position.userId, exchange);
      const { createExchange } = await import('@rfsanz/exchange');
      const marketAdapter = createExchange(exchange as any, account);
      let marketSnapshot: Record<string, unknown>;
      try {
        await marketAdapter.connect(account);
        const protectionListId = typeof positionMeta.protectionListId === 'string'
          ? positionMeta.protectionListId
          : typeof positionMeta.protectionListClientOrderId === 'string'
            ? positionMeta.protectionListClientOrderId
            : undefined;
        const protectionAdapter = marketAdapter as {
          cancelProtectionOrder?: (orderId: string, symbol?: string) => Promise<void>;
        };
        if (protectionListId && typeof protectionAdapter.cancelProtectionOrder === 'function') {
          await protectionAdapter.cancelProtectionOrder(protectionListId, position.symbol);
        }
        const snapshot = await fetchCanonicalMarketSnapshot(marketAdapter, {
          symbol: position.symbol,
          side,
          quantity: Number(position.quantity),
        });
        marketSnapshot = {
          bid: snapshot.bid,
          ask: snapshot.ask,
          mid: snapshot.mid,
          spread: snapshot.spread,
          spreadBps: snapshot.spreadBps,
          liquidity: snapshot.liquidity,
          slippage: snapshot.slippage,
          volatility: snapshot.volatility,
          stale: snapshot.stale,
          marketTimestamp: new Date(snapshot.timestamp).toISOString(),
          marketSource: snapshot.source,
          marketAuthority: snapshot.authority,
        };
      } finally {
        await marketAdapter.disconnect();
      }
      const closePrice = Number(marketSnapshot.bid ?? position.entryPrice);
      const riskStopDistance = closePrice * 0.02;
      const riskRewardDistance = riskStopDistance * 2;
      const closeRiskMeta = side === 'SELL'
        ? {
          stopLoss: closePrice + riskStopDistance,
          targetPrice: closePrice - riskRewardDistance,
        }
        : {
          stopLoss: closePrice - riskStopDistance,
          targetPrice: closePrice + riskRewardDistance,
        };
      const closeMeta = {
        intent: 'CLOSE',
        positionId,
        closeReason: reason ?? 'MANUAL',
        requestedAt: new Date().toISOString(),
        ...marketSnapshot,
        ...closeRiskMeta,
      };
      const existingClose = (await prisma.order.findMany({
        where: {
          userId: position.userId,
          symbol: position.symbol,
          status: 'NEW',
          externalId: null,
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      })).find((candidate) => {
        const meta = candidate.meta as Record<string, unknown> | null | undefined;
        return meta?.intent === 'CLOSE' && meta.positionId === positionId;
      });
      const order = existingClose
        ? await prisma.order.update({
          where: { id: existingClose.id },
          data: { price: closePrice, quantity: position.quantity, exchange, meta: closeMeta },
        })
        : await prisma.order.create({
          data: {
            userId: position.userId,
            symbol: position.symbol,
            side,
            quantity: position.quantity,
            price: closePrice,
            exchange,
            status: 'NEW',
            meta: closeMeta,
          },
        });
      await this.submitToExchange(order.id);
      await prisma.position.update({
        where: { id: positionId },
        data: { meta: { ...positionMeta, closeOrderId: order.id, closeRequestedAt: new Date().toISOString() } },
      });
      return { orderId: order.id, status: 'CLOSE_REQUESTED' };
  }

  /**
   * PHASE 2: Get all open positions for user
   */
  async getOpenPositions(userId: string): Promise<any[]> {
    try {
      return await this.positionService.getOpenPositions(userId);
    } catch (error) {
      this.logger.error(`Failed to get open positions: ${error}`);
      throw error;
    }
  }

  /**
   * PHASE 2: Get all closed positions for user
   */
  async getClosedPositions(userId: string): Promise<any[]> {
    try {
      return await this.positionService.getClosedPositions(userId);
    } catch (error) {
      this.logger.error(`Failed to get closed positions: ${error}`);
      throw error;
    }
  }

  /**
   * PHASE 2: Update trading statistics
   */
  async updateTradingStats(userId: string): Promise<void> {
    try {
      await this.pnlCalculationService.updateTradingStatistics(userId);
      this.logger.log(`Trading statistics updated for user ${userId}`);
    } catch (error) {
      this.logger.error(`Failed to update trading stats: ${error}`);
      throw error;
    }
  }

  private async resolveExecutionAccount(userId: string, exchange: string): Promise<any> {
    if (process.env.TRADING_MODE === 'TESTNET') {
      if (exchange.toLowerCase() !== 'binance') {
        throw new OrderValidationFailedException('TESTNET execution requires Binance');
      }
      return resolveCanonicalTestnetAccount(userId);
    }
    if (process.env.TRADING_MODE === 'LIVE') {
      if (exchange.toLowerCase() !== 'binance') {
        throw new OrderValidationFailedException('LIVE execution requires Binance');
      }
      return resolveCanonicalLiveAccount(userId);
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        exchangeAccounts: {
          where: { exchange, isActive: true },
          include: { apiKeys: { where: { revoked: false } } },
        },
      },
    });
    const exchangeAccount = user?.exchangeAccounts?.find((account) => account.exchange === exchange);
    if (!exchangeAccount) {
      throw new OrderValidationFailedException(`No active exchange account found for ${exchange}`);
    }
    return {
      id: exchangeAccount.id,
      userId,
      exchange,
      accountId: exchangeAccount.accountId,
      credentials: this.resolveExchangeCredentials(exchangeAccount.apiKeys, exchange),
      isActive: exchangeAccount.isActive,
      isPaper: process.env.TRADING_MODE === 'PAPER',
      tradingMode: process.env.TRADING_MODE as 'PAPER' | 'LIVE',
    };
  }

  private resolveExchangeCredentials(
      apiKeys: Array<{ keyHash: string; secretEncrypted: string | null }> | undefined,
      exchange: string,
    ): { apiKey: string; apiSecret: string } | undefined {
      if (process.env.TRADING_MODE === 'PAPER') return undefined;
      const record = apiKeys?.find((key) => Boolean(key.secretEncrypted));
      if (!record?.keyHash || !record.secretEncrypted) {
        throw new OrderValidationFailedException(
          `Encrypted credentials are required for ${exchange}`,
        );
      }
      this.credentialCrypto ??= new CredentialCryptoService();
      return {
        apiKey: record.keyHash,
        apiSecret: this.credentialCrypto.decrypt(record.secretEncrypted),
      };
  }

  private getRiskConfiguration(): {
    minAccountBalanceUsd: number;
    maxOrderValueUsd: number;
    dailyLossLimitUsd: number;
    maxPositionSizePercent: number;
    maxConcurrentPositions: number;
    version: string;
  } {
    const isLive = process.env.TRADING_MODE === 'LIVE';
    const read = (name: string, fallback: number): number => {
      const raw = process.env[name];
      if (raw === undefined || raw.trim() === '') {
        if (isLive) throw new RiskLimitExceededException(`${name} is required for LIVE execution`);
        return fallback;
      }
      const value = Number(raw);
      if (!Number.isFinite(value) || value <= 0) {
        throw new RiskLimitExceededException(`${name} must be a positive finite number`);
      }
      return value;
    };
    const maxPositionSizePercent = read('TRADING_MAX_POSITION_SIZE_PERCENT', 10);
    if (maxPositionSizePercent > 100) {
      throw new RiskLimitExceededException('TRADING_MAX_POSITION_SIZE_PERCENT must not exceed 100');
    }
    const maxConcurrentPositions = read('TRADING_MAX_CONCURRENT_POSITIONS', 5);
    if (!Number.isInteger(maxConcurrentPositions)) {
      throw new RiskLimitExceededException('TRADING_MAX_CONCURRENT_POSITIONS must be an integer');
    }
    const minAccountBalanceUsd = read('TRADING_MIN_ACCOUNT_BALANCE_USD', 50);
    const maxOrderValueUsd = read('TRADING_MAX_ORDER_VALUE_USD', 500);
    if (maxOrderValueUsd < minAccountBalanceUsd) {
      throw new RiskLimitExceededException('TRADING_MAX_ORDER_VALUE_USD must not be below TRADING_MIN_ACCOUNT_BALANCE_USD');
    }
    const dailyLossLimitUsd = read('TRADING_DAILY_LOSS_LIMIT_USD', 1000);
    const version = process.env.RISK_CONFIG_VERSION?.trim();
    if (isLive && !version) {
      throw new RiskLimitExceededException('RISK_CONFIG_VERSION is required for LIVE execution');
    }
    return {
      minAccountBalanceUsd,
      maxOrderValueUsd,
      dailyLossLimitUsd,
      maxPositionSizePercent,
      maxConcurrentPositions,
      version: version ?? 'risk-default',
    };
  }
}
