export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
export type RiskCheckStatus = 'PASS' | 'FAIL' | 'WARN';
export type RiskTradeIntent = 'ENTRY' | 'EXIT' | 'REDUCE' | 'CLOSE' | 'REVERSAL';

export function resolveTradeIntent(
  side: 'BUY' | 'SELL',
  position: { side: 'BUY' | 'SELL'; quantity: number } | undefined,
  quantity: number,
): RiskTradeIntent {
  if (!position) return 'ENTRY';
  const isClosingSide = (position.side === 'BUY' && side === 'SELL')
    || (position.side === 'SELL' && side === 'BUY');
  if (!isClosingSide) return 'ENTRY';
  if (quantity > position.quantity + 1e-9) return 'REVERSAL';
  return quantity >= position.quantity - 1e-9 ? 'CLOSE' : 'REDUCE';
}

export interface RiskCheckResult {
  checkName: string;
  status: RiskCheckStatus;
  value: number;
  threshold: number;
  reason: string;
}

export interface RiskConfiguration {
  maxRiskPerTrade: number;
  maxPortfolioHeat: number;
  maxDailyLoss: number;
  maxWeeklyLoss: number;
  maxDrawdown: number;
  maxConcurrentPositions: number;
  maxSymbolExposure: number;
  maxCorrelatedExposure: number;
  maxLeverage: number;
  maxPositionNotional: number;
  maxOpenOrders: number;
  maxSpread: number;
  maxSlippage: number;
  minLiquidity: number;
  maxConsecutiveLosses: number;
  minRiskReward: number;
  sizeReductionAllowed: boolean;
  authorizationTtlMs: number;
  defaultKillReason?: string;
}

export interface RiskAccountSnapshot {
  totalEquity: number;
  availableBalance: number;
  marginUsed: number;
  freeMargin: number;
  unrealizedPnL: number;
  realizedPnL: number;
  leverage: number;
  peakEquity: number;
  currentDrawdown: number;
  dailyPnL: number;
  weeklyPnL: number;
  consecutiveLosses: number;
  tradingEnabled: boolean;
  killSwitch: boolean;
  killReason?: string;
}

export interface RiskPositionSnapshot {
  symbol: string;
  side: 'long' | 'short';
  quantity: number;
  entryPrice: number;
  notional: number;
  exposure: number;
}

export interface RiskMarketSnapshot {
  spread: number;
  liquidity: number;
  slippage: number;
  stale: boolean;
  volatility: number;
  correlationCluster?: string;
  clusterExposure?: number;
  correlation?: number;
}

export interface RiskTradeInput {
  decisionId: string;
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  intent?: RiskTradeIntent;
  positionId?: string;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  requestedPositionSize: number;
  riskAmount: number;
  portfolioHeatBefore: number;
  symbolExposureBefore: number;
  correlatedExposureBefore: number;
  leverage: number;
  marginRequired: number;
  estimatedFees: number;
  estimatedSlippage: number;
  dailyPnL: number;
  dailyLossLimit: number;
  drawdown: number;
  riskVersion?: string;
}

export interface RiskDecision {
  riskDecisionId: string;
  decisionId: string;
  approved: boolean;
  reason: string;
  riskLevel: RiskLevel;
  requestedRisk: number;
  approvedRisk: number;
  requestedPositionSize: number;
  approvedPositionSize: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  stopDistance: number;
  riskAmount: number;
  portfolioHeatBefore: number;
  portfolioHeatAfter: number;
  symbolExposureBefore: number;
  symbolExposureAfter: number;
  correlatedExposureBefore: number;
  correlatedExposureAfter: number;
  leverage: number;
  marginRequired: number;
  estimatedFees: number;
  estimatedSlippage: number;
  dailyPnL: number;
  dailyLossLimit: number;
  drawdown: number;
  riskChecks: RiskCheckResult[];
  failedChecks: string[];
  createdAt: number;
  riskVersion: string;
  requestedRiskExceeded: boolean;
  reducedFromRequested: boolean;
  reductionReason?: string;
  authorizationExpiresAt?: number;
}

export interface RiskEvaluationInput {
  trade: RiskTradeInput;
  account: RiskAccountSnapshot;
  positions: RiskPositionSnapshot[];
  market: RiskMarketSnapshot;
  config?: Partial<RiskConfiguration>;
}

const trustedRiskDecisions = new WeakSet<object>();

export function isTrustedRiskDecision(value: unknown): value is RiskDecision {
  return typeof value === 'object' && value !== null && trustedRiskDecisions.has(value);
}

export class RiskEngine {
  static readonly DEFAULT_CONFIG: RiskConfiguration = {
    maxRiskPerTrade: 0.02,
    maxPortfolioHeat: 0.04,
    maxDailyLoss: 0.05,
    maxWeeklyLoss: 0.12,
    maxDrawdown: 0.1,
    maxConcurrentPositions: 5,
    maxSymbolExposure: 0.25,
    maxCorrelatedExposure: 0.3,
    maxLeverage: 3,
    maxPositionNotional: 10000,
    maxOpenOrders: 3,
    maxSpread: 0.004,
    maxSlippage: 0.01,
    minLiquidity: 0.35,
    maxConsecutiveLosses: 5,
    minRiskReward: 1.5,
    sizeReductionAllowed: false,
    authorizationTtlMs: 30_000,
    defaultKillReason: 'Risk limit exceeded',
  };

  constructor(private readonly config: RiskConfiguration = RiskEngine.DEFAULT_CONFIG) {}

  evaluate(input: RiskEvaluationInput): RiskDecision {
    const effectiveConfig = { ...RiskEngine.DEFAULT_CONFIG, ...this.config, ...(input.config ?? {}) };
    const now = Date.now();
    const checks: RiskCheckResult[] = [];
    const failedChecks: string[] = [];

    const requestedRisk = this.safeNumber(input.trade.riskAmount / Math.max(input.account.totalEquity, 1));
    const requestedRiskExceeded = requestedRisk > effectiveConfig.maxRiskPerTrade;
    const sizeReductionAllowed = effectiveConfig.sizeReductionAllowed === true;
    const approvedRisk = requestedRiskExceeded && sizeReductionAllowed
      ? this.safeNumber(Math.min(requestedRisk, effectiveConfig.maxRiskPerTrade))
      : requestedRisk;
    const stopDistance = Math.abs(input.trade.entry - input.trade.stopLoss) || 0;
    const portfolioHeatAfter = this.safeNumber(input.trade.portfolioHeatBefore + approvedRisk);
    const symbolExposureAfter = this.safeNumber(input.trade.symbolExposureBefore + approvedRisk);
    const correlatedExposureAfter = this.safeNumber(input.trade.correlatedExposureBefore + approvedRisk * 1.3);

    const accountChecks = this.validateAccount(input, effectiveConfig, checks, failedChecks, requestedRisk, approvedRisk, requestedRiskExceeded, sizeReductionAllowed);
    const marketChecks = this.validateMarket(input, effectiveConfig, checks, failedChecks);
    const portfolioChecks = this.validatePortfolio(input, effectiveConfig, checks, failedChecks, portfolioHeatAfter, symbolExposureAfter, correlatedExposureAfter);
    const tradeChecks = this.validateTrade(input, effectiveConfig, checks, failedChecks, stopDistance, approvedRisk);

    const allChecks = [...accountChecks, ...marketChecks, ...portfolioChecks, ...tradeChecks];
    const approved = allChecks.every((check) => check.status !== 'FAIL') && !input.account.killSwitch && input.account.tradingEnabled && !(requestedRiskExceeded && !sizeReductionAllowed);
    const riskLevel: RiskLevel = approved
      ? (requestedRisk >= effectiveConfig.maxRiskPerTrade * 0.8 ? 'medium' : 'low')
      : (requestedRisk >= effectiveConfig.maxRiskPerTrade * 0.8 || input.account.currentDrawdown > effectiveConfig.maxDrawdown * 0.8 ? 'high' : 'critical');

    const reductionReason = requestedRiskExceeded && sizeReductionAllowed
      ? 'RISK_PER_TRADE_EXCEEDED: reduced to configured maximum risk cap'
      : undefined;

    const reason = failedChecks.length > 0
      ? failedChecks.join('; ')
      : approved
        ? (requestedRiskExceeded && sizeReductionAllowed ? 'Risk checks passed; execution authorized after size reduction.' : 'Risk checks passed; execution authorized.')
        : 'Risk checks failed; execution denied.';

    const decision: RiskDecision = {
      riskDecisionId: `risk-${input.trade.decisionId}-${now}`,
      decisionId: input.trade.decisionId,
      approved,
      reason,
      riskLevel,
      requestedRisk,
      approvedRisk,
      requestedPositionSize: this.safeNumber(input.trade.requestedPositionSize),
      approvedPositionSize: this.safeNumber(Math.min(input.trade.requestedPositionSize, input.trade.requestedPositionSize * (approvedRisk / Math.max(requestedRisk, 0.0001)))),
      entry: this.safeNumber(input.trade.entry),
      stopLoss: this.safeNumber(input.trade.stopLoss),
      takeProfit: this.safeNumber(input.trade.takeProfit),
      stopDistance,
      riskAmount: this.safeNumber(input.trade.riskAmount),
      portfolioHeatBefore: this.safeNumber(input.trade.portfolioHeatBefore),
      portfolioHeatAfter,
      symbolExposureBefore: this.safeNumber(input.trade.symbolExposureBefore),
      symbolExposureAfter,
      correlatedExposureBefore: this.safeNumber(input.trade.correlatedExposureBefore),
      correlatedExposureAfter,
      leverage: this.safeNumber(input.trade.leverage),
      marginRequired: this.safeNumber(input.trade.marginRequired),
      estimatedFees: this.safeNumber(input.trade.estimatedFees),
      estimatedSlippage: this.safeNumber(input.trade.estimatedSlippage),
      dailyPnL: this.safeNumber(input.trade.dailyPnL),
      dailyLossLimit: this.safeNumber(input.trade.dailyLossLimit),
      drawdown: this.safeNumber(input.trade.drawdown),
      riskChecks: allChecks,
      failedChecks,
      createdAt: now,
      riskVersion: input.trade.riskVersion ?? 'risk-v1',
      requestedRiskExceeded,
      reducedFromRequested: requestedRiskExceeded && sizeReductionAllowed,
      reductionReason,
      authorizationExpiresAt: now + effectiveConfig.authorizationTtlMs,
    };
    trustedRiskDecisions.add(decision);
    return decision;
  }

  private validateAccount(
    input: RiskEvaluationInput,
    config: RiskConfiguration,
    checks: RiskCheckResult[],
    failedChecks: string[],
    requestedRisk: number,
    approvedRisk: number,
    requestedRiskExceeded: boolean,
    sizeReductionAllowed: boolean,
  ): RiskCheckResult[] {
    const results: RiskCheckResult[] = [];

    if (!Number.isFinite(input.account.totalEquity) || input.account.totalEquity <= 0) {
      results.push(this.fail('ACCOUNT_EQUITY', 0, 1, 'Zero or invalid equity'));
    } else {
      results.push(this.pass('ACCOUNT_EQUITY', requestedRisk, config.maxRiskPerTrade, 'Account equity is valid'));
    }

    if (!input.account.tradingEnabled) {
      results.push(this.fail('TRADING_ENABLED', 0, 1, 'Trading disabled'));
    } else {
      results.push(this.pass('TRADING_ENABLED', 1, 1, 'Trading enabled'));
    }

    if (input.account.killSwitch) {
      results.push(this.fail('KILL_SWITCH', 1, 0, input.account.killReason ?? config.defaultKillReason ?? 'Kill switch enabled'));
    } else {
      results.push(this.pass('KILL_SWITCH', 0, 0, 'Kill switch not triggered'));
    }

    if (input.account.dailyPnL <= -config.maxDailyLoss * input.account.totalEquity) {
      results.push(this.fail('DAILY_LOSS_LIMIT', input.account.dailyPnL, -config.maxDailyLoss * input.account.totalEquity, 'Daily loss limit exceeded'));
    } else {
      results.push(this.pass('DAILY_LOSS_LIMIT', input.account.dailyPnL, -config.maxDailyLoss * input.account.totalEquity, 'Daily loss within limit'));
    }

    if (input.account.weeklyPnL <= -config.maxWeeklyLoss * input.account.totalEquity) {
      results.push(this.fail('WEEKLY_LOSS_LIMIT', input.account.weeklyPnL, -config.maxWeeklyLoss * input.account.totalEquity, 'Weekly loss limit exceeded'));
    } else {
      results.push(this.pass('WEEKLY_LOSS_LIMIT', input.account.weeklyPnL, -config.maxWeeklyLoss * input.account.totalEquity, 'Weekly loss within limit'));
    }

    if (input.account.currentDrawdown > config.maxDrawdown) {
      results.push(this.fail('MAX_DRAWDOWN', input.account.currentDrawdown, config.maxDrawdown, 'Drawdown exceeds limit'));
    } else {
      results.push(this.pass('MAX_DRAWDOWN', input.account.currentDrawdown, config.maxDrawdown, 'Drawdown within limit'));
    }

    if (input.account.consecutiveLosses >= config.maxConsecutiveLosses) {
      results.push(this.fail('CONSECUTIVE_LOSSES', input.account.consecutiveLosses, config.maxConsecutiveLosses, 'Too many consecutive losses'));
    } else {
      results.push(this.pass('CONSECUTIVE_LOSSES', input.account.consecutiveLosses, config.maxConsecutiveLosses, 'Consecutive losses within limit'));
    }

    if (requestedRiskExceeded && !sizeReductionAllowed) {
      results.push(this.fail('RISK_PER_TRADE_EXCEEDED', requestedRisk, config.maxRiskPerTrade, 'Requested risk exceeds configured maximum; reduction is not allowed'));
    } else if (requestedRiskExceeded && sizeReductionAllowed) {
      results.push(this.warn('RISK_PER_TRADE_EXCEEDED', requestedRisk, config.maxRiskPerTrade, 'Requested risk exceeded maximum; reduced to safe approved risk'));
    }

    if (approvedRisk > config.maxRiskPerTrade) {
      results.push(this.fail('MAX_RISK_PER_TRADE', approvedRisk, config.maxRiskPerTrade, 'Approved risk above configured threshold'));
    } else {
      results.push(this.pass('MAX_RISK_PER_TRADE', approvedRisk, config.maxRiskPerTrade, 'Approved risk within per-trade cap'));
    }

    if (input.account.freeMargin < input.trade.marginRequired) {
      results.push(this.fail('FREE_MARGIN', input.account.freeMargin, input.trade.marginRequired, 'Not enough free margin'));
    } else {
      results.push(this.pass('FREE_MARGIN', input.account.freeMargin, input.trade.marginRequired, 'Available margin sufficient'));
    }

    results.forEach((result) => {
      if (result.status === 'FAIL') failedChecks.push(result.checkName);
    });

    return results;
  }

  private validateMarket(
    input: RiskEvaluationInput,
    config: RiskConfiguration,
    checks: RiskCheckResult[],
    failedChecks: string[],
  ): RiskCheckResult[] {
    const results: RiskCheckResult[] = [];

    if (input.market.stale) {
      results.push(this.fail('MARKET_FRESHNESS', 1, 0, 'Market snapshot is stale'));
    } else {
      results.push(this.pass('MARKET_FRESHNESS', 0, 0, 'Market snapshot fresh'));
    }

    if (input.market.spread > config.maxSpread) {
      results.push(this.fail('MAX_SPREAD', input.market.spread, config.maxSpread, 'Spread exceeds configured cap'));
    } else {
      results.push(this.pass('MAX_SPREAD', input.market.spread, config.maxSpread, 'Spread within tolerance'));
    }

    if (input.market.slippage > config.maxSlippage) {
      results.push(this.fail('MAX_SLIPPAGE', input.market.slippage, config.maxSlippage, 'Estimated slippage exceeds cap'));
    } else {
      results.push(this.pass('MAX_SLIPPAGE', input.market.slippage, config.maxSlippage, 'Slippage within tolerance'));
    }

    if (input.market.liquidity < config.minLiquidity) {
      results.push(this.fail('MIN_LIQUIDITY', input.market.liquidity, config.minLiquidity, 'Liquidity below minimum'));
    } else {
      results.push(this.pass('MIN_LIQUIDITY', input.market.liquidity, config.minLiquidity, 'Liquidity above minimum'));
    }

    results.forEach((result) => {
      if (result.status === 'FAIL') failedChecks.push(result.checkName);
    });

    return results;
  }

  private validatePortfolio(
    input: RiskEvaluationInput,
    config: RiskConfiguration,
    checks: RiskCheckResult[],
    failedChecks: string[],
    portfolioHeatAfter: number,
    symbolExposureAfter: number,
    correlatedExposureAfter: number,
  ): RiskCheckResult[] {
    const results: RiskCheckResult[] = [];

    if (portfolioHeatAfter > config.maxPortfolioHeat) {
      results.push(this.fail('MAX_PORTFOLIO_HEAT', portfolioHeatAfter, config.maxPortfolioHeat, 'Portfolio heat would exceed limit'));
    } else {
      results.push(this.pass('MAX_PORTFOLIO_HEAT', portfolioHeatAfter, config.maxPortfolioHeat, 'Portfolio heat within limit'));
    }

    if (symbolExposureAfter > config.maxSymbolExposure) {
      results.push(this.fail('MAX_SYMBOL_EXPOSURE', symbolExposureAfter, config.maxSymbolExposure, 'Symbol exposure above cap'));
    } else {
      results.push(this.pass('MAX_SYMBOL_EXPOSURE', symbolExposureAfter, config.maxSymbolExposure, 'Symbol exposure within cap'));
    }

    if (correlatedExposureAfter > config.maxCorrelatedExposure) {
      results.push(this.fail('MAX_CORRELATED_EXPOSURE', correlatedExposureAfter, config.maxCorrelatedExposure, 'Correlated cluster exposure exceeded'));
    } else {
      results.push(this.pass('MAX_CORRELATED_EXPOSURE', correlatedExposureAfter, config.maxCorrelatedExposure, 'Correlated exposure within cap'));
    }

    results.forEach((result) => {
      if (result.status === 'FAIL') failedChecks.push(result.checkName);
    });

    return results;
  }

  private validateTrade(
    input: RiskEvaluationInput,
    config: RiskConfiguration,
    checks: RiskCheckResult[],
    failedChecks: string[],
    stopDistance: number,
    approvedRisk: number,
  ): RiskCheckResult[] {
    const results: RiskCheckResult[] = [];

    if (stopDistance <= 0 || !Number.isFinite(stopDistance)) {
      results.push(this.fail('STOP_DISTANCE', stopDistance, 1, 'Invalid stop distance'));
    } else {
      results.push(this.pass('STOP_DISTANCE', stopDistance, 1, 'Stop distance valid'));
    }

    const isExit = input.trade.intent === 'EXIT' || input.trade.intent === 'REDUCE' || input.trade.intent === 'CLOSE';
    const validDirection = input.trade.action === 'BUY'
      ? input.trade.stopLoss < input.trade.entry && input.trade.entry < input.trade.takeProfit
      : input.trade.action === 'SELL'
        ? input.trade.takeProfit < input.trade.entry && input.trade.entry < input.trade.stopLoss
        : true;
    if (!isExit && input.trade.action !== 'HOLD' && !validDirection) {
      results.push(this.fail('TAKE_PROFIT_VALIDATION', input.trade.takeProfit, input.trade.entry, 'Stop-loss/take-profit are not valid for trade direction'));
    } else {
      results.push(this.pass('TAKE_PROFIT_VALIDATION', input.trade.takeProfit, input.trade.entry, 'Take-profit direction valid'));
    }

    const rr = stopDistance > 0 ? Math.abs(input.trade.takeProfit - input.trade.entry) / stopDistance : 0;
    if (rr < config.minRiskReward) {
      results.push(this.fail('RISK_REWARD', rr, config.minRiskReward, 'Risk/reward is below minimum'));
    } else {
      results.push(this.pass('RISK_REWARD', rr, config.minRiskReward, 'Risk/reward meets minimum'));
    }

    if (approvedRisk <= 0 || !Number.isFinite(approvedRisk)) {
      results.push(this.fail('POSITION_SIZE', approvedRisk, 0.0001, 'Risk size invalid'));
    } else {
      results.push(this.pass('POSITION_SIZE', approvedRisk, 0.0001, 'Position size valid'));
    }

    if (input.trade.action === 'HOLD') {
      results.push(this.fail('TRADE_ACTION', 0, 1, 'HOLD is not executable'));
    } else {
      results.push(this.pass('TRADE_ACTION', 1, 1, 'Trade direction valid'));
    }

    results.forEach((result) => {
      if (result.status === 'FAIL') failedChecks.push(result.checkName);
    });

    return results;
  }

  private pass(checkName: string, value: number, threshold: number, reason: string): RiskCheckResult {
    return { checkName, status: 'PASS', value, threshold, reason };
  }

  private warn(checkName: string, value: number, threshold: number, reason: string): RiskCheckResult {
    return { checkName, status: 'WARN', value, threshold, reason };
  }

  private fail(checkName: string, value: number, threshold: number, reason: string): RiskCheckResult {
    return { checkName, status: 'FAIL', value, threshold, reason };
  }

  private safeNumber(value: number | undefined | null): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) return 0;
    return value;
  }
}

export default new RiskEngine();
