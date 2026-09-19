import { SystemReadinessService } from './system-readiness.service';
import { ExchangeAccount } from '../types';
import { assertLiveApproval } from './live-approval.service';

export type TradingMode = 'PAPER' | 'TESTNET' | 'LIVE';

export interface ExecutionCapability {
  mode: TradingMode;
  exchange: string;
  liveTradingEnabled: boolean;
}

function readMode(env: NodeJS.ProcessEnv = process.env): TradingMode {
  const value = env.TRADING_MODE ?? 'PAPER';
  if (value !== 'PAPER' && value !== 'TESTNET' && value !== 'LIVE') {
    throw new Error(`Unsupported TRADING_MODE: ${value}`);
  }
  return value;
}

export function resolveExecutionCapability(
  exchange: string,
  env: NodeJS.ProcessEnv = process.env,
): ExecutionCapability {
  const mode = readMode(env);
  const liveTradingEnabled = env.LIVE_TRADING_ENABLED === 'true';

  if (mode === 'PAPER' && exchange !== 'paper') {
    throw new Error('PAPER mode only permits the paper exchange adapter');
  }
  if (mode !== 'PAPER' && exchange !== 'binance') {
    throw new Error(`${mode} mode only permits the Binance exchange adapter`);
  }
  if (mode === 'LIVE' && !liveTradingEnabled) {
    throw new Error('LIVE mode requires LIVE_TRADING_ENABLED=true');
  }
  if (mode !== 'LIVE' && liveTradingEnabled) {
    throw new Error('LIVE_TRADING_ENABLED=true is only valid in LIVE mode');
  }

  return { mode, exchange, liveTradingEnabled };
}

export function assertExecutionAllowed(
  exchange: string,
  account?: ExchangeAccount,
  readiness = SystemReadinessService.getInstance(),
  allowExit = false,
): ExecutionCapability {
  const capability = resolveExecutionCapability(exchange);
  const accountMode = account?.tradingMode;
  if (accountMode && accountMode !== capability.mode) {
    throw new Error(`Execution mode mismatch: account=${accountMode}, runtime=${capability.mode}`);
  }

  if ((!allowExit && !readiness.canCreateNewEntry()) || (allowExit && readiness.report().phase !== 'SYSTEM_READY')) {
    const report = readiness.report();
    throw new Error(`Trading system not ready: phase=${report.phase}; reason=${report.reason}`);
  }

  const report = readiness.report();
  if (capability.mode === 'LIVE' && !report.checks.LIVE_READY) {
    throw new Error('LIVE execution requires LIVE_READY=true');
  }
  if (capability.mode === 'LIVE') {
    const riskConfigVersion = process.env.RISK_CONFIG_VERSION?.trim();
    if (!riskConfigVersion) {
      throw new Error('LIVE execution requires RISK_CONFIG_VERSION');
    }
    assertLiveApproval({
      accountId: account?.id ?? '',
      riskConfigVersion,
    });
  }
  if (capability.mode === 'TESTNET' && !report.checks.TESTNET_READY) {
    throw new Error('TESTNET execution requires TESTNET_READY=true');
  }

  return capability;
}
