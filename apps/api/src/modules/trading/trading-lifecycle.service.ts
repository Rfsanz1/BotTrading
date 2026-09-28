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
import { RedisService } from '../../common/redis.service';
import { AnalysisService } from '../analysis/services/analysis.service';
import { BinanceMarketDataService } from '../market-intelligence/services/binance-market-data.service';
import { CalibrationService } from '../market-intelligence/services/calibration.service';
import { SymbolRegistryService } from '../market-intelligence/services/symbol-registry.service';
import { TradingService } from './trading.service';
import { resolveCanonicalTestnetAccount } from './canonical-testnet-account';
import { resolveCanonicalLiveAccount } from './canonical-live-account';
import { getKillSwitch } from './kill-switch';
import { validateLiveSymbolMetadata } from './live-symbol-metadata';

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
  private livePreflightTimer: NodeJS.Timeout | null = null;
  private initialized = false;
  private shuttingDown = false;
  private runtimeCanonicalAccountValid = false;
  private runtimeCredentialValid = false;

  constructor(
    private readonly tradingService: TradingService,
    private readonly redis: RedisService,
    private readonly analysis: AnalysisService,
    private readonly marketData: BinanceMarketDataService,
    private readonly calibration: CalibrationService,
    private readonly symbols: SymbolRegistryService,
  ) {}

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
      this.runtimeCanonicalAccountValid = Boolean(account.id && account.accountId && account.isActive);
      this.runtimeCredentialValid = Boolean(account.credentials?.apiKey && account.credentials?.apiSecret);
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
      const aiStatus = await this.analysis.getRuntimeStatus();
      this.readiness.setCheck(
        'AI_READY',
        aiStatus.initialized && aiStatus.providerConfigured && aiStatus.healthy,
        aiStatus.healthy ? 'production AI provider healthy' : `production AI unavailable: ${aiStatus.lastFailure?.category ?? 'UNHEALTHY'}`,
      );
      const calibrationStatus = await this.calibration.calibrate(0.5, Date.now());
      this.readiness.setCheck(
        'LEARNING_READY',
        calibrationStatus.state === 'CALIBRATION_READY',
        `${calibrationStatus.state}: samples=${calibrationStatus.sampleSize}`,
      );
      const riskReady = isRiskConfigurationValid(process.env);
      this.readiness.setCheck('RISK_READY', riskReady, riskReady ? 'risk configuration valid' : 'risk configuration invalid');
      this.readiness.setCheck(
        'EXECUTION_READY',
        Boolean(this.adapter && typeof this.adapter.placeOrder === 'function' && this.adapter.connected === true),
        this.adapter?.connected === true ? 'connected execution adapter available' : 'execution adapter is not connected',
      );
      this.readiness.setCheck('STARTUP_GATE_READY', true, 'startup and event router ready');
      if (mode === 'PAPER') {
        this.readiness.setCheck('PAPER_READY', true, 'paper application initialized');
        this.readiness.setCheck('LIVE_READY', false, 'LIVE preflight is blocked while TRADING_MODE is PAPER');
      } else if (mode === 'TESTNET') {
        this.readiness.setCheck('TESTNET_READY', true, 'testnet application initialized');
        this.readiness.setCheck('LIVE_READY', false, 'LIVE preflight is blocked while TRADING_MODE is TESTNET');
      } else if (mode === 'LIVE') {
        await this.refreshLivePreflight(result.status === 'HEALTHY');
        this.livePreflightTimer = setInterval(() => {
          void this.refreshLivePreflight().catch((error) => {
            this.logger.warn(`LIVE preflight refresh failed: ${error instanceof Error ? error.name : 'UNKNOWN_ERROR'}`);
            this.readiness.setCheck('LIVE_READY', false, 'runtime LIVE preflight refresh failed');
          });
        }, 30_000);
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
    if (this.livePreflightTimer) {
      clearInterval(this.livePreflightTimer);
      this.livePreflightTimer = null;
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
      runtimeExchangeAccounts.length !== 1
      || runtimeExchangeAccounts[0].userId !== this.runtimeAccount.userId
      || runtimeExchangeAccounts[0].exchange !== this.runtimeAccount.exchange
      || runtimeExchangeAccounts[0].accountId !== this.runtimeAccount.accountId
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
    this.readiness.setCheck('RECONCILIATION_READY', result.status === 'HEALTHY', 'runtime reconciliation executed');
    return result;
  }

  private async refreshLivePreflight(startupReconciliationHealthy = false): Promise<void> {
    const diagnostics: string[] = [];
    let databaseReachable = false;
    let redisReachable = false;
    let killSwitchAvailable = false;
    let killSwitchActive = true;
    let marketDataReady = false;
    let aiReady = false;
    let calibrationReady = false;
    let symbolMetadataValid = false;
    let reconciliationAvailable = false;

    try {
      await prisma.$queryRawUnsafe('SELECT 1');
      databaseReachable = true;
    } catch {
      diagnostics.push('PostgreSQL health query failed');
    }
    try {
      redisReachable = (await this.redis.ping()) === 'PONG';
    } catch {
      diagnostics.push('Redis PING failed');
    }
    try {
      const state = await getKillSwitch();
      killSwitchAvailable = true;
      killSwitchActive = state.active;
      if (state.reason === 'Kill switch state unavailable') diagnostics.push('Kill switch row is missing');
    } catch {
      diagnostics.push('Kill switch database query failed');
    }
    try {
      const status = await this.analysis.getRuntimeStatus();
      aiReady = status.initialized && status.providerConfigured && status.reachable && status.healthy;
      if (!aiReady) diagnostics.push(`AI health failed: ${status.lastFailure?.category ?? 'provider not healthy'}`);
    } catch {
      diagnostics.push('AI runtime status unavailable');
    }
    try {
      const status = await this.calibration.calibrate(0.5, Date.now());
      calibrationReady = status.state === 'CALIBRATION_READY' && status.calibratedProbability !== null;
      if (!calibrationReady) diagnostics.push(`Calibration unavailable: ${status.state}, samples=${status.sampleSize}`);
    } catch {
      diagnostics.push('Calibration query failed');
    }
    try {
      const registry = await this.symbols.awaitReady();
      const enabledSymbols = (await this.symbols.list()).filter((entry) =>
        entry.enabled && entry.exchange === 'binance' && entry.marketType === 'spot' && entry.quoteAsset === 'USDT');
      const exchangeSymbols = await this.adapter?.fetchAllSymbolInfo?.();
      const metadata = validateLiveSymbolMetadata(enabledSymbols, exchangeSymbols ?? []);
      symbolMetadataValid = registry.status === 'HEALTHY' && metadata.valid;
      if (registry.status !== 'HEALTHY') diagnostics.push(`Symbol registry is ${registry.status}`);
      if (!metadata.valid) diagnostics.push(metadata.reason);
    } catch {
      diagnostics.push('Binance exchangeInfo metadata request failed');
    }
    try {
      const bootstrap = await this.marketData.awaitReady();
      const streams = this.marketData.status().spot;
      const maxEventAgeMs = positiveEnvNumber(process.env.LIVE_MARKET_MAX_EVENT_AGE_MS) ?? 120_000;
      const eventAgeMs = streams.lastEventAt === null ? Number.POSITIVE_INFINITY : Date.now() - streams.lastEventAt;
      marketDataReady = bootstrap.status === 'READY'
        && bootstrap.requested > 0
        && bootstrap.canonicalFresh >= bootstrap.requested
        && streams.streamsRequested > 0
        && streams.coveragePercent === 100
        && streams.streamsActive === streams.streamsRequested
        && streams.healthyShards === streams.shardCount
        && streams.eventsReceived > 0
        && eventAgeMs >= 0
        && eventAgeMs <= maxEventAgeMs;
      if (!marketDataReady) {
        diagnostics.push(`Market data unhealthy: bootstrap=${bootstrap.status}, websocketCoverage=${streams.coveragePercent}%, events=${streams.eventsReceived}, eventAgeMs=${Number.isFinite(eventAgeMs) ? eventAgeMs : 'unknown'}`);
      }
    } catch {
      diagnostics.push('Market data health unavailable');
    }
    try {
      const reconciliation = startupReconciliationHealthy
        ? { status: 'HEALTHY' as const }
        : await this.reconcileAll();
      reconciliationAvailable = reconciliation.status === 'HEALTHY'
        && this.adapter?.supportsPositionReconciliation === true;
      if (!reconciliationAvailable) diagnostics.push('Exchange reconciliation is not verified as supported and healthy');
    } catch {
      diagnostics.push('Exchange reconciliation query failed');
    }

    const executionReady = Boolean(
      this.adapter
      && this.adapter.connected === true
      && typeof this.adapter.placeOrder === 'function'
      && typeof this.adapter.fetchBalances === 'function',
    );
    if (!executionReady) diagnostics.push('Connected exchange execution capabilities are incomplete');

    const preflight = validateLivePreflight({
      tradingMode: process.env.TRADING_MODE,
      liveTradingEnabled: process.env.LIVE_TRADING_ENABLED,
      liveAccountId: process.env.LIVE_EXCHANGE_ACCOUNT_ID,
      encryptionKey: process.env.EXCHANGE_CREDENTIAL_ENCRYPTION_KEY,
      riskConfigVersion: process.env.RISK_CONFIG_VERSION,
      risk: process.env,
      databaseReachable,
      redisReachable,
      canonicalAccountValid: this.runtimeCanonicalAccountValid,
      credentialValid: this.runtimeCredentialValid,
      symbolMetadataValid,
      reconciliationAvailable,
      killSwitchAvailable,
      killSwitchActive,
      marketDataReady,
      aiReady,
      calibrationReady,
      executionReady,
      exchange: this.adapter,
    });
    const failures = [...preflight.failures, ...diagnostics];
    this.readiness.setCheck(
      'LIVE_READY',
      preflight.ok,
      preflight.ok ? 'runtime LIVE preflight passed' : `runtime LIVE preflight blocked: ${failures.join('; ')}`,
    );
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

function positiveEnvNumber(raw: string | undefined): number | null {
  if (raw === undefined || raw.trim() === '') return null;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function isRiskConfigurationValid(env: NodeJS.ProcessEnv): boolean {
  return [
    'TRADING_MIN_ACCOUNT_BALANCE_USD',
    'TRADING_MAX_ORDER_VALUE_USD',
    'TRADING_DAILY_LOSS_LIMIT_USD',
    'TRADING_MAX_POSITION_SIZE_PERCENT',
    'TRADING_MAX_CONCURRENT_POSITIONS',
  ].every((name) => {
    const raw = env[name];
    const value = raw === undefined ? NaN : Number(raw);
    return Number.isFinite(value) && value > 0;
  });
}
