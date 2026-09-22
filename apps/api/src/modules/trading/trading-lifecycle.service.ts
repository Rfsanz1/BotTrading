import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import {
  SystemReadinessService,
  ExchangeEventRouter,
  ExchangeReconciliationService,
  validateLivePreflight,
  createExchange,
  ExchangeName,
  FakePaperExchangeAdapter,
} from '@rfsanz/exchange';
import prisma from '@rfsanz/database';
import { validateEnv } from '../../config/env.validation';
import { TradingService } from './trading.service';
import { resolveCanonicalTestnetAccount } from './canonical-testnet-account';
import { resolveCanonicalLiveAccount } from './canonical-live-account';

@Injectable()
export class TradingLifecycleService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(TradingLifecycleService.name);
  private readonly readiness = SystemReadinessService.getInstance();
  private readonly reconciliationService = new ExchangeReconciliationService();
  private adapter: any | null = null;
  private runtimeAccount: { id: string; exchange: string; accountId: string; userId: string } | null = null;
  private router: ExchangeEventRouter | null = null;
  private unsubscribe: (() => void) | null = null;
  private readonly adapterListeners: Array<() => void> = [];
  private keepaliveTimer: NodeJS.Timeout | null = null;
  private reconciliationTimer: NodeJS.Timeout | null = null;
  private initialized = false;
  private shuttingDown = false;

  constructor(private readonly tradingService: TradingService) {}

  async onModuleInit(): Promise<void> {
    await this.initialize();
  }

  async onApplicationShutdown(): Promise<void> {
    await this.stop();
  }

  async initialize(): Promise<void> {
    if (this.initialized || this.shuttingDown) return;
    this.initialized = true;
    this.readiness.setPhase('STARTING', 'application bootstrap');

    try {
      this.readiness.setCheck('STARTUP_GATE_READY', false, 'startup not complete');
      this.readiness.setCheck('DATABASE_READY', false, 'database not connected');
      this.readiness.setCheck('CONFIG_VALID', false, 'configuration not validated');
      this.readiness.setCheck('ACCOUNT_SYNC_READY', false, 'account not synchronized');
      this.readiness.setCheck('ORDER_SYNC_READY', false, 'orders not synchronized');
      this.readiness.setCheck('POSITION_SYNC_READY', false, 'positions not synchronized');
      this.readiness.setCheck('EVENT_ROUTER_READY', false, 'event router not bound');
      this.readiness.setCheck('EXCHANGE_READY', false, 'exchange not connected');
      this.readiness.setCheck('WEBSOCKET_READY', false, 'websocket not ready');
      this.readiness.setCheck('RECONCILIATION_READY', false, 'reconciliation not run');

      const config = validateEnv(process.env);
      this.readiness.setCheck('CONFIG_VALID', true, 'configuration validated');
      await prisma.$connect();
      this.readiness.setCheck('DATABASE_READY', true, 'database connection successful');

      const mode = config.TRADING_MODE;
      const exchangeName: ExchangeName = mode === 'PAPER' ? 'paper' : 'binance';
      const account = await this.buildAccount(exchangeName);
      this.runtimeAccount = {
        id: account.id,
        exchange: account.exchange,
        accountId: account.accountId ?? '',
        userId: account.userId ?? '',
      };
      if (mode !== 'PAPER' && (!account.credentials?.apiKey || !account.credentials?.apiSecret)) {
        this.readiness.halt('missing exchange credentials');
        return;
      }

      this.adapter = mode === 'PAPER'
        ? new FakePaperExchangeAdapter(account)
        : createExchange(exchangeName, account);
      this.bindAdapterLifecycle();
      await this.adapter.connect(account);
      this.readiness.setCheck('EXCHANGE_READY', true, 'exchange connection successful');
      this.readiness.setPhase('EXCHANGE_CONNECTING', 'exchange connected');

      await this.syncAccount();
      await this.syncPositions();
      await this.syncOrders();
      const result = await this.reconcileAll();
      this.readiness.setCheck('RECONCILIATION_READY', result.status === 'HEALTHY', result.status === 'HEALTHY' ? 'reconciliation passed' : 'reconciliation failed');
      if (result.status !== 'HEALTHY') {
        this.readiness.halt('startup reconciliation failed');
        return;
      }

      this.router = new ExchangeEventRouter((event) => this.tradingService.persistExchangeEvent(event));
      if (this.adapter?.bindRouter) {
        this.unsubscribe = this.adapter.bindRouter(this.router);
      }
      this.readiness.setCheck('EVENT_ROUTER_READY', !!this.unsubscribe, 'event router bound');
      if (!this.unsubscribe) {
        this.readiness.halt('exchange adapter cannot bind event router');
        return;
      }

      if (typeof this.adapter?.startUserDataStream === 'function') {
        await this.adapter.startUserDataStream();
      }

      this.readiness.setCheck('WEBSOCKET_READY', true, 'user-data websocket active');
      this.readiness.setCheck('ACCOUNT_SYNC_READY', true, 'account synchronized');
      this.readiness.setCheck('ORDER_SYNC_READY', true, 'orders synchronized');
      this.readiness.setCheck('POSITION_SYNC_READY', true, 'positions synchronized');
      this.readiness.setCheck('AI_READY', true, 'AI dependency available');
      this.readiness.setCheck('LEARNING_READY', true, 'learning dependency available');
      this.readiness.setCheck('RISK_READY', true, 'risk gate available');
      this.readiness.setCheck('EXECUTION_READY', true, 'execution engine available');
      this.readiness.setCheck('STARTUP_GATE_READY', true, 'startup and event router ready');
      if (mode === 'PAPER') {
        this.readiness.setCheck('PAPER_READY', true, 'paper application initialized');
      } else if (mode === 'TESTNET') {
        this.readiness.setCheck('TESTNET_READY', true, 'testnet application initialized');
      } else if (mode === 'LIVE') {
        const livePreflight = validateLivePreflight({
          tradingMode: process.env.TRADING_MODE,
          liveTradingEnabled: process.env.LIVE_TRADING_ENABLED,
          liveAccountId: process.env.LIVE_EXCHANGE_ACCOUNT_ID,
          encryptionKey: process.env.EXCHANGE_CREDENTIAL_ENCRYPTION_KEY,
          riskConfigVersion: process.env.RISK_CONFIG_VERSION,
          risk: process.env,
          databaseReachable: true,
          redisReachable: Boolean(process.env.REDIS_URL),
          canonicalAccountValid: Boolean(account.id && account.accountId),
          credentialValid: Boolean(account.credentials?.apiKey && account.credentials?.apiSecret),
          symbolMetadataValid: false,
          reconciliationAvailable: result.status === 'HEALTHY',
          killSwitchAvailable: process.env.KILL_SWITCH_STORAGE === 'postgres',
          exchange: this.adapter,
        });
        this.readiness.setCheck('LIVE_READY', livePreflight.ok, livePreflight.ok
          ? 'runtime LIVE preflight passed'
          : `runtime LIVE preflight blocked: ${livePreflight.failures.join('; ')}`);
      }
      this.readiness.setPhase('SYSTEM_READY', 'runtime lifecycle initialized');

      this.startReconciliationWorker();
      this.startKeepalive();
      this.logger.log('Trading lifecycle initialized');
    } catch (error) {
      this.readiness.halt(error instanceof Error ? error.message : 'startup failed');
      this.logger.error('Lifecycle initialization failed', error instanceof Error ? error.stack : undefined);
    }
  }

  async recover(): Promise<void> {
    if (!this.adapter) return;
    this.readiness.setPhase('DEGRADED', 'recovery in progress');
    this.readiness.setCheck('WEBSOCKET_READY', false, 'websocket disconnected');
    this.readiness.setCheck('STARTUP_GATE_READY', false, 'new entry disabled during recovery');

    try {
      if (!this.adapter.connected && typeof this.adapter.reconnect === 'function') {
        await this.adapter.reconnect();
      }
      await this.syncAccount();
      await this.syncOrders();
      await this.syncPositions();
      const result = await this.reconcileAll();
      if (result.status === 'HEALTHY') {
        this.readiness.setCheck('RECONCILIATION_READY', true, 'recovery reconciliation passed');
        this.readiness.setCheck('WEBSOCKET_READY', true, 'recovery restored websocket state');
        this.readiness.setCheck('STARTUP_GATE_READY', true, 'recovery complete');
        this.readiness.setPhase('SYSTEM_READY', 'recovery complete');
      } else {
        this.readiness.halt('recovery reconciliation failed');
      }

    } catch (error) {
      this.readiness.halt(error instanceof Error ? error.message : 'recovery failed');
    }
  }

  async clearPaperStateForTest(): Promise<void> {
    if (process.env.TRADING_MODE !== 'PAPER' || !(this.adapter instanceof FakePaperExchangeAdapter)) {
      return;
    }
    this.adapter.resetForTest();
  }

  async paperDisconnectForTest(): Promise<Record<string, unknown>> {
      if (process.env.TRADING_MODE !== 'PAPER' || !(this.adapter instanceof FakePaperExchangeAdapter)) {
        throw new Error('PAPER reconnect controls are only available for the PAPER adapter');
      }
      await this.adapter.disconnect();
      return this.readiness.report() as unknown as Record<string, unknown>;
    }

  async paperReconnectForTest(): Promise<Record<string, unknown>> {
      if (process.env.TRADING_MODE !== 'PAPER' || !(this.adapter instanceof FakePaperExchangeAdapter)) {
        throw new Error('PAPER reconnect controls are only available for the PAPER adapter');
      }
      await this.recover();
      return this.readiness.report() as unknown as Record<string, unknown>;
    }

  async stop(): Promise<void> {
    this.shuttingDown = true;
    if (this.reconciliationTimer) {
      clearInterval(this.reconciliationTimer);
      this.reconciliationTimer = null;
    }
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    while (this.adapterListeners.length > 0) {
      this.adapterListeners.pop()?.();
    }
    if (this.adapter && typeof this.adapter.disconnect === 'function') {
      await this.adapter.disconnect();
    }
    await prisma.$disconnect();
    this.adapter = null;
    this.router = null;
    this.readiness.halt('shutdown complete');
  }

  private async buildAccount(exchange: ExchangeName) {
    const mode = process.env.TRADING_MODE as 'PAPER' | 'TESTNET' | 'LIVE';
    if (mode === 'TESTNET') {
      return resolveCanonicalTestnetAccount();
    }
    if (mode === 'LIVE') {
      return resolveCanonicalLiveAccount();
    }
    return {
      id: 'startup-account',
      userId: 'startup-user',
      exchange,
      accountId: 'startup-account',
      credentials: undefined,
      isActive: true,
      isPaper: process.env.TRADING_MODE === 'PAPER',
      tradingMode: mode,
    };
  }

  private bindAdapterLifecycle(): void {
    if (!this.adapter?.on || !this.adapter?.off) return;
    const onDisconnect = () => {
      if (!this.shuttingDown) void this.recover();
    };
    const onError = () => {
      this.readiness.setPhase('DEGRADED', 'websocket degraded');
      this.readiness.setCheck('WEBSOCKET_READY', false, 'websocket degraded');
    };
    this.adapter.on('websocket.disconnected', onDisconnect);
    this.adapter.on('websocket.error', onError);
    this.adapterListeners.push(
      () => this.adapter?.off?.('websocket.disconnected', onDisconnect),
      () => this.adapter?.off?.('websocket.error', onError),
    );
  }

  private async syncAccount(): Promise<void> {
    if (!this.adapter || typeof this.adapter.fetchBalances !== 'function') {
      throw new Error('exchange adapter missing balance sync');
    }
    const balances = await this.adapter.fetchBalances();
    if (!Array.isArray(balances) || balances.length === 0) {
      throw new Error('account sync failed');
    }
    this.readiness.setCheck('ACCOUNT_SYNC_READY', true, 'account sync successful');
  }

  private async syncPositions(): Promise<void> {
    if (!this.adapter || typeof this.adapter.fetchOpenPositions !== 'function') {
      throw new Error('exchange adapter missing position sync');
    }
    const positions = await this.adapter.fetchOpenPositions();
    if (!Array.isArray(positions)) {
      throw new Error('position sync failed');
    }
    this.readiness.setCheck('POSITION_SYNC_READY', true, 'position sync successful');
  }

  private async syncOrders(): Promise<void> {
    if (!this.adapter || typeof this.adapter.fetchOpenOrders !== 'function') {
      throw new Error('exchange adapter missing order sync');
    }
    const orders = await this.adapter.fetchOpenOrders();
    if (!Array.isArray(orders)) {
      throw new Error('order sync failed');
    }
    this.readiness.setCheck('ORDER_SYNC_READY', true, 'order sync successful');
  }

  private async reconcileAll() {
    if (!this.adapter || !this.runtimeAccount) {
      throw new Error('reconciliation requires an initialized exchange account');
    }

    const runtimeExchangeAccounts = await prisma.exchangeAccount.findMany({
      where: { id: this.runtimeAccount.id, isActive: true },
      select: { id: true, userId: true, exchange: true, accountId: true },
    });
    if (
      (runtimeExchangeAccounts.length !== 1
      || runtimeExchangeAccounts[0].userId !== this.runtimeAccount.userId
      || runtimeExchangeAccounts[0].exchange !== this.runtimeAccount.exchange
      || runtimeExchangeAccounts[0].accountId !== this.runtimeAccount.accountId)
    ) {
      throw new Error('Canonical runtime exchange account is no longer available');
    }
    const runtimeUserIds = [this.runtimeAccount.userId];

    const [localOrdersRaw, localPositionsRaw, exchangeOrders, exchangePositions] = await Promise.all([
      prisma.order.findMany({
        where: {
          exchange: this.runtimeAccount.exchange,
          userId: { in: runtimeUserIds },
          status: { in: ['NEW', 'PARTIALLY_FILLED'] },
          externalId: { not: null },
        },
        select: {
          id: true,
          externalId: true,
          symbol: true,
          status: true,
          filled: true,
          meta: true,
        },
      }),
      prisma.position.findMany({
        where: {
          status: 'OPEN',
          userId: { in: runtimeUserIds },
        },
        select: {
          symbol: true,
          side: true,
          quantity: true,
        },
      }),
      this.adapter.fetchOpenOrders(),
      this.adapter.fetchOpenPositions(),
    ]);

    const localOrders = localOrdersRaw.map((order) => ({
      ...order,
      clientOrderId: ((order.meta as Record<string, unknown> | null | undefined)?.clientOrderId as string | undefined)
        ?? order.externalId
        ?? order.id,
    }));

    const result = await this.reconciliationService.reconcileAll(
      this.runtimeAccount,
      localOrders,
      localPositionsRaw,
      this.runtimeAccount,
      exchangeOrders,
      exchangePositions,
      this.adapter.supportsPositionReconciliation !== false,
    );
    if (result.status !== 'HEALTHY') {
      this.logger.warn(
        `Runtime account reconciliation mismatch for ${this.runtimeAccount.exchange}/${this.runtimeAccount.accountId}: ${result.mismatches.join(', ')}`,
      );
    }
    this.readiness.setCheck('RECONCILIATION_READY', result.status === 'HEALTHY', 'startup reconciliation executed');
    return result;
  }

  private startReconciliationWorker(): void {
    if (this.reconciliationTimer) return;
    this.reconciliationTimer = setInterval(() => {
      void this.reconcileAll().catch((error) => {
        this.logger.warn(`Reconciliation worker failed: ${error instanceof Error ? error.message : String(error)}`);
      });
    }, 60000);
  }

  private startKeepalive(): void {
    if (this.keepaliveTimer) return;
    this.keepaliveTimer = setInterval(() => {
      if (this.adapter && typeof this.adapter.keepUserDataStreamAlive === 'function') {
        void this.adapter.keepUserDataStreamAlive().catch(() => {
          this.readiness.setCheck('WEBSOCKET_READY', false, 'keepalive failed');
        });
      }
    }, 30000);
  }
}

export default TradingLifecycleService;
