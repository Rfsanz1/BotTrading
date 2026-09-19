export type SystemReadinessPhase =
  | 'STARTING'
  | 'DATABASE_READY'
  | 'CONFIG_VALID'
  | 'EXCHANGE_CONNECTING'
  | 'EXCHANGE_READY'
  | 'ACCOUNT_SYNC'
  | 'POSITION_SYNC'
  | 'ORDER_SYNC'
  | 'RECONCILIATION'
  | 'WEBSOCKET_READY'
  | 'RISK_READY'
  | 'AI_READY'
  | 'SYSTEM_READY'
  | 'DEGRADED'
  | 'HALTED';

export type SystemReadinessKey =
  | 'DATABASE_READY'
  | 'CONFIG_VALID'
  | 'ACCOUNT_SYNC_READY'
  | 'ORDER_SYNC_READY'
  | 'POSITION_SYNC_READY'
  | 'EVENT_ROUTER_READY'
  | 'AI_READY'
  | 'LEARNING_READY'
  | 'RISK_READY'
  | 'EXECUTION_READY'
  | 'EXCHANGE_READY'
  | 'WEBSOCKET_READY'
  | 'RECONCILIATION_READY'
  | 'STARTUP_GATE_READY'
  | 'PAPER_READY'
  | 'TESTNET_READY'
  | 'LIVE_READY';

export interface ReadinessReport {
  phase: SystemReadinessPhase;
  ready: boolean;
  checks: Record<SystemReadinessKey, boolean>;
  lastUpdatedAt: number;
  reason: string;
}

export class SystemReadinessService {
  private static instance: SystemReadinessService | null = null;

  private phase: SystemReadinessPhase = 'STARTING';
  private reason = 'booting';
  private lastUpdatedAt = Date.now();
  private checks: Record<SystemReadinessKey, boolean> = {
    DATABASE_READY: false,
    CONFIG_VALID: false,
    ACCOUNT_SYNC_READY: false,
    ORDER_SYNC_READY: false,
    POSITION_SYNC_READY: false,
    EVENT_ROUTER_READY: false,
    AI_READY: false,
    LEARNING_READY: false,
    RISK_READY: false,
    EXECUTION_READY: false,
    EXCHANGE_READY: false,
    WEBSOCKET_READY: false,
    RECONCILIATION_READY: false,
    STARTUP_GATE_READY: false,
    PAPER_READY: false,
    TESTNET_READY: false,
    LIVE_READY: false,
  };
  private readonly criticalChecks: SystemReadinessKey[] = [
    'DATABASE_READY',
    'CONFIG_VALID',
    'ACCOUNT_SYNC_READY',
    'ORDER_SYNC_READY',
    'POSITION_SYNC_READY',
    'RECONCILIATION_READY',
    'EVENT_ROUTER_READY',
    'WEBSOCKET_READY',
    'RISK_READY',
    'AI_READY',
    'LEARNING_READY',
    'STARTUP_GATE_READY',
  ];

  static getInstance(): SystemReadinessService {
    if (!SystemReadinessService.instance) {
      SystemReadinessService.instance = new SystemReadinessService();
    }
    return SystemReadinessService.instance;
  }

  setPhase(phase: SystemReadinessPhase, reason?: string): void {
    this.phase = phase;
    this.reason = reason ?? this.reason;
    this.lastUpdatedAt = Date.now();
  }

  setCheck(key: SystemReadinessKey, value: boolean, reason?: string): void {
    this.checks[key] = value;
    this.lastUpdatedAt = Date.now();
    if (reason) this.reason = reason;

    const allHealthy = this.criticalChecks.every((criticalKey) => this.checks[criticalKey]);
    if (allHealthy && this.phase !== 'HALTED') {
      this.phase = 'SYSTEM_READY';
      this.reason = reason ?? 'all critical checks healthy';
      return;
    }

    if (!value && this.phase !== 'HALTED') {
      this.phase = 'DEGRADED';
    }
  }

  markReady(key: SystemReadinessKey, reason?: string): void {
    this.setCheck(key, true, reason);
  }

  halt(reason: string): void {
    this.setPhase('HALTED', reason);
    for (const key of Object.keys(this.checks) as SystemReadinessKey[]) {
      if (key !== 'LIVE_READY') this.checks[key] = false;
    }
  }

  canCreateNewEntry(): boolean {
    if (this.phase !== 'SYSTEM_READY') return false;
    return this.criticalChecks.every((criticalKey) => this.checks[criticalKey]);
  }

  report(): ReadinessReport {
    const ready = this.canCreateNewEntry();
    return {
      phase: this.phase,
      ready,
      checks: { ...this.checks },
      lastUpdatedAt: this.lastUpdatedAt,
      reason: this.reason,
    };
  }
}

export default SystemReadinessService;
