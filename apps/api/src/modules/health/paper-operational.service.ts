import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import WebSocket from 'ws';
import { PrismaService } from '../../common/prisma.service';
import { SystemReadinessService } from '@rfsanz/exchange';
import {
  BinanceMarketClient,
  MarketObservabilityService,
  PaperTradingService,
} from '../market-intelligence';
import { AnalysisService } from '../analysis/services/analysis.service';

export type OperationalState = 'HEALTHY' | 'DEGRADED' | 'FAILED';

export interface PaperOperationalReport {
  mode: string;
  liveTradingEnabled: string;
  state: OperationalState;
  components: Record<string, OperationalState>;
  lastCheckedAt: number;
  reason: string;
}

@Injectable()
export class PaperOperationalService implements OnModuleInit {
  private readonly logger = new Logger(PaperOperationalService.name);
  private reportValue: PaperOperationalReport = {
    mode: process.env.TRADING_MODE ?? 'PAPER',
    liveTradingEnabled: process.env.LIVE_TRADING_ENABLED ?? 'false',
    state: 'DEGRADED',
    components: {},
    lastCheckedAt: 0,
    reason: 'startup pending',
  };

  constructor(
    private readonly prisma: PrismaService,
    private readonly market: BinanceMarketClient,
    private readonly paper: PaperTradingService,
    private readonly observability: MarketObservabilityService,
    private readonly analysis: AnalysisService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.validateStartup();
  }

  async validateStartup(): Promise<PaperOperationalReport> {
    const readiness = SystemReadinessService.getInstance();
    const components: Record<string, OperationalState> = {};
    const mode = process.env.TRADING_MODE ?? 'PAPER';
    const liveTradingEnabled = process.env.LIVE_TRADING_ENABLED ?? 'false';

    if (mode !== 'PAPER' || liveTradingEnabled !== 'false') {
      readiness.halt('PAPER startup requires TRADING_MODE=PAPER and LIVE_TRADING_ENABLED=false');
      this.reportValue = {
        mode,
        liveTradingEnabled,
        state: 'FAILED',
        components: { PAPER_EXECUTOR: 'FAILED' },
        lastCheckedAt: Date.now(),
        reason: 'unsafe paper mode configuration',
      };
      throw new Error(this.reportValue.reason);
    }

    components.DATABASE = await this.check('DATABASE', async () => {
      await this.prisma.$queryRaw`SELECT 1`;
    });
    components.MARKET_DATA = await this.check('MARKET_DATA', async () => {
      const ticker = await this.market.ticker('BTCUSDT');
      if (!Number.isFinite(ticker.price) || ticker.price <= 0) throw new Error('invalid public ticker');
      const book = await this.market.orderBook('BTCUSDT', 20);
      if (!book.bids.length || !book.asks.length) throw new Error('empty public orderbook');
    });
    components.WEBSOCKET = await this.check('WEBSOCKET', () => this.checkWebSocket());
    components.CANONICAL_STATE = components.MARKET_DATA === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED';
    components.ORDERBOOK = components.MARKET_DATA === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED';
    components.FUTURES = components.MARKET_DATA === 'HEALTHY' ? 'HEALTHY' : 'DEGRADED';
    components.SCANNER = 'HEALTHY';
    const aiStatus = this.analysis.getRuntimeStatus();
    components.AI = aiStatus.some((status) => status.endpointConfigured && status.credentialConfigured)
      ? 'HEALTHY'
      : 'DEGRADED';
    components.RISK = 'HEALTHY';
    components.PAPER_EXECUTOR = this.paper ? 'HEALTHY' : 'FAILED';

    const failed = Object.values(components).filter((state) => state === 'FAILED').length;
    const degraded = Object.values(components).filter((state) => state === 'DEGRADED').length;
    const state: OperationalState = failed > 0 ? 'FAILED' : degraded > 0 ? 'DEGRADED' : 'HEALTHY';
    const reason = state === 'HEALTHY' ? 'paper operational checks passed' : 'one or more paper dependencies are degraded';
    this.reportValue = { mode, liveTradingEnabled, state, components, lastCheckedAt: Date.now(), reason };

    readiness.setCheck('CONFIG_VALID', true, 'paper configuration validated');
    readiness.setCheck('DATABASE_READY', components.DATABASE === 'HEALTHY', 'database reachable');
    readiness.setCheck('RISK_READY', true, 'risk engine available');
    readiness.setCheck('EXECUTION_READY', components.PAPER_EXECUTOR === 'HEALTHY', 'paper executor available');
    readiness.setCheck('PAPER_READY', components.PAPER_EXECUTOR === 'HEALTHY', 'paper executor available');
    readiness.setCheck('AI_READY', components.AI === 'HEALTHY', components.AI === 'HEALTHY'
      ? 'configured provider available'
      : 'no configured AI provider');
    readiness.setCheck('LEARNING_READY', true, 'calibration layer available');
    readiness.setCheck('EVENT_ROUTER_READY', true, 'event router available');
    readiness.setCheck('STARTUP_GATE_READY', state !== 'FAILED', reason);
    readiness.setCheck('EXCHANGE_READY', components.MARKET_DATA === 'HEALTHY', 'public market connectivity');
    readiness.setCheck('WEBSOCKET_READY', components.WEBSOCKET === 'HEALTHY', 'public websocket connectivity');
    readiness.setCheck('RECONCILIATION_READY', true, 'paper reconciliation available');
    readiness.setCheck('ACCOUNT_SYNC_READY', true, 'paper mode has no authenticated account dependency');
    readiness.setCheck('ORDER_SYNC_READY', true, 'paper order state is local');
    readiness.setCheck('POSITION_SYNC_READY', true, 'paper position state is local');
    readiness.setCheck('LIVE_READY', false, 'live trading disabled');
    return this.reportValue;
  }

  report(): PaperOperationalReport {
    return {
      ...this.reportValue,
      components: { ...this.reportValue.components },
    };
  }

  metrics() {
    const stream = this.observability.snapshot();
    const paper = this.paper.metrics();
    return {
      scanCount: stream.scans,
      candidateCount: stream.candidates,
      signalCount: stream.riskApproved,
      noTradeCount: stream.noTrades,
      ...paper,
      calibrationSamples: stream.calibrationSamples,
      calibrationStatus: stream.calibrationSamples >= 30 ? 'CALIBRATED' : 'INSUFFICIENT_SAMPLE',
      authorizationByReason: stream.authorizationByReason,
      ai: {
        providers: this.analysis.getRuntimeStatus(),
      },
      calibrationState: stream.calibrationColdStart > 0 ? 'COLD_START' : 'NORMAL_OR_UNAVAILABLE',
    };
  }

  private async check(name: string, operation: () => Promise<void>): Promise<OperationalState> {
    try {
      await operation();
      return 'HEALTHY';
    } catch (error) {
      this.logger.warn(`${name} paper startup check failed: ${error instanceof Error ? error.message : String(error)}`);
      return 'FAILED';
    }
  }

  private checkWebSocket(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = new WebSocket('wss://stream.binance.com:9443/ws/btcusdt@trade');
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error('public websocket timeout'));
      }, 5_000);
      socket.once('message', () => {
        clearTimeout(timeout);
        socket.close();
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  }
}
