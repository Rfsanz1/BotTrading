import { Injectable, Optional } from '@nestjs/common';
import { RiskEngine, RiskDecision, RiskEvaluationInput } from '@rfsanz/exchange';
import { CanonicalMarketState } from '../interfaces/canonical-market.interface';
import { AiValidationService, StructuredAiValidation } from './ai-validation.service';
import { EntryExitService, EntryExitResult } from './entry-exit.service';
import { ExpectedValueResult, ExpectedValueService } from './expected-value.service';
import { MarketStructureService, StructureState } from './market-structure.service';
import { MultiTimeframeService, MultiTimeframeAlignment } from './multi-timeframe.service';
import { OpportunityResult, OpportunityService } from './opportunity.service';
import { RegimeResult, RegimeService } from './regime.service';
import { TradingCostEstimate, TradingCostModel } from './trading-cost-model';

export type FinalDecisionStatus = 'NO_TRADE' | 'WATCH' | 'AI_INVALID' | 'AI_UNAVAILABLE' | 'AI_AUTH_ERROR' | 'AI_RATE_LIMITED' | 'AI_SERVER_ERROR' | 'REJECTED_BY_RISK' | 'AUTHORIZED_FOR_PAPER' | 'PAPER_COLD_START';

export interface TradingDecision {
  decisionId: string;
  symbol: string;
  marketType: CanonicalMarketState['marketType'];
  timestamp: number;
  dataQuality: CanonicalMarketState['dataQuality'];
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  decisionState: OpportunityResult['decision'];
  setupType: string;
  regime: RegimeResult;
  opportunityScore: number;
  opportunity: OpportunityResult;
  alignment: MultiTimeframeAlignment;
  structure: StructureState | null;
  aiValidation: StructuredAiValidation | null;
  confidenceRaw: number | null;
  calibratedProbability: number | null;
  expectedValue: ExpectedValueResult;
  costEstimate: TradingCostEstimate | null;
  entry: EntryExitResult | null;
  riskAssessment: RiskDecision | null;
  executionQuality: OpportunityResult['executionQuality'];
  reasons: string[];
  warnings: string[];
  finalStatus: FinalDecisionStatus;
  calibrationState: 'CALIBRATION_READY' | 'CALIBRATION_COLD_START' | 'CALIBRATION_UNAVAILABLE';
  calibrationSampleSize: number;
  calibrationMethod: string | null;
  calibrationVersion: string | null;
  authorizationReason: string | null;
}

export interface FinalPipelineInput {
  aiOutput?: unknown;
  calibratedProbability?: number | null;
  account?: RiskEvaluationInput['account'];
  positions?: RiskEvaluationInput['positions'];
  portfolioHeatBefore?: number;
  symbolExposureBefore?: number;
  correlatedExposureBefore?: number;
  equity?: number;
  riskPerTrade?: number;
  decisionTimestamp?: number;
  calibrationState?: TradingDecision['calibrationState'];
  calibrationSampleSize?: number;
  calibrationMethod?: string;
  calibrationVersion?: string;
}

@Injectable()
export class TradingDecisionPipelineService {
  private readonly riskEngine = new RiskEngine();
  private readonly costModel: TradingCostModel;

  constructor(
    private readonly multiTimeframe: MultiTimeframeService,
    private readonly regimeService: RegimeService,
    private readonly opportunityService: OpportunityService,
    private readonly structureService: MarketStructureService,
    private readonly aiValidation: AiValidationService,
    private readonly evService: ExpectedValueService,
    private readonly entryExit: EntryExitService,
    @Optional() costModel?: TradingCostModel,
  ) {
    this.costModel = costModel ?? new TradingCostModel();
  }

  evaluate(state: CanonicalMarketState, input: FinalPipelineInput = {}): TradingDecision {
    const alignment = this.multiTimeframe.align(state.timeframes);
    const structure = this.latestStructure(state);
    const regime = this.regimeService.evaluate(state, alignment, structure ?? undefined);
    const opportunity = this.opportunityService.evaluate(state, alignment, regime, structure ?? undefined);
    const decisionId = `decision-${state.symbol}-${state.lastUpdate ?? Date.now()}`;
    const base: TradingDecision = {
      decisionId,
      symbol: state.symbol,
      marketType: state.marketType,
      timestamp: input.decisionTimestamp ?? Date.now(),
      dataQuality: state.dataQuality,
      direction: opportunity.directionBias,
      decisionState: opportunity.decision,
      setupType: opportunity.setupType,
      regime,
      opportunityScore: opportunity.opportunityScore,
      opportunity,
      alignment,
      structure,
      aiValidation: null,
      confidenceRaw: null,
      calibratedProbability: input.calibrationState === 'CALIBRATION_READY'
        && Number.isFinite(input.calibratedProbability)
        && input.calibratedProbability! >= 0 && input.calibratedProbability! <= 1
        ? input.calibratedProbability! : null,
      expectedValue: this.unavailableEv('DETERMINISTIC_GATE'),
      costEstimate: null,
      entry: null,
      riskAssessment: null,
      executionQuality: opportunity.executionQuality,
      reasons: [...opportunity.noTradeReasons],
      warnings: [],
      finalStatus: 'NO_TRADE' as FinalDecisionStatus,
      calibrationState: input.calibrationState ?? 'CALIBRATION_UNAVAILABLE',
      calibrationSampleSize: input.calibrationSampleSize ?? 0,
      calibrationMethod: input.calibrationMethod ?? null,
      calibrationVersion: input.calibrationVersion ?? null,
      authorizationReason: null,
    };

    const hardGate = this.hardGate(base.reasons);
    if (hardGate) {
      base.reasons = [hardGate, ...base.reasons.filter((reason) => reason !== hardGate)];
      return base;
    }
    if (opportunity.decision !== 'LONG_SETUP' && opportunity.decision !== 'SHORT_SETUP') {
      base.finalStatus = 'WATCH';
      return base;
    }
    const ai = this.aiValidation.validate(input.aiOutput);
    if (ai.state !== 'VALID') {
      base.finalStatus = ai.state;
      base.authorizationReason = ai.state;
      base.reasons.push(base.authorizationReason);
      return base;
    }
    if (ai.value.direction !== opportunity.directionBias) {
      base.finalStatus = 'NO_TRADE';
      base.reasons.push('AI_DIRECTION_CONFLICT');
      return base;
    }
    base.aiValidation = ai.value;
    base.confidenceRaw = ai.value.confidenceRaw;
    if (base.calibratedProbability === null) {
      if (base.calibrationState === 'CALIBRATION_COLD_START'
        && process.env.TRADING_MODE === 'PAPER' && process.env.PAPER_COLD_START_ENABLED === 'true') {
      } else {
        base.finalStatus = 'NO_TRADE';
        base.authorizationReason = base.calibrationState === 'CALIBRATION_COLD_START' ? 'CALIBRATION_COLD_START' : 'CALIBRATION_UNAVAILABLE';
        base.reasons.push(base.authorizationReason, 'CALIBRATED_PROBABILITY_UNAVAILABLE');
        return base;
      }
    }

    const price = state.mid ?? state.lastPrice;
    const spread = state.bid !== null && state.ask !== null ? state.ask - state.bid : null;
    const protectedLevel = base.direction === 'LONG' ? structure?.protectedLow : structure?.protectedHigh;
    if (price === null || spread === null || protectedLevel === null || protectedLevel === undefined) {
      base.reasons.push('STRUCTURE_INVALID');
      return base;
    }
    const entry = this.entryExit.calculate({
      direction: base.direction as 'LONG' | 'SHORT',
      price,
      spread,
      atr: state.timeframes[alignment.entryTimeframe]?.volatility
        ? price * state.timeframes[alignment.entryTimeframe]!.volatility!
        : null,
      structureInvalidation: protectedLevel,
      liquidityTargets: [],
      structureTargets: [base.direction === 'LONG' ? structure?.protectedHigh : structure?.protectedLow].filter((value): value is number => value !== null && value !== undefined),
    });
    base.entry = entry;
    const target = entry.tp1;
    if (!target || entry.stopLoss === null) {
      base.reasons.push('STRUCTURE_INVALID');
      return base;
    }
    const coldStart = base.calibrationState === 'CALIBRATION_COLD_START'
      && process.env.TRADING_MODE === 'PAPER' && process.env.PAPER_COLD_START_ENABLED === 'true';
    const evProbability = coldStart ? ai.value.confidenceRaw : base.calibratedProbability;
    const estimatedSlippage = state.orderBook
      ? Math.max(state.orderBook.estimatedBuySlippage ?? Number.NaN, state.orderBook.estimatedSellSlippage ?? Number.NaN)
      : Number.NaN;
    const costEstimate = this.costModel.estimate({
      marketType: state.marketType,
      entryPrice: entry.preferredEntry,
      stopLoss: entry.stopLoss,
      spreadFraction: spread / price,
      slippageFraction: estimatedSlippage,
      fundingRate: state.marketType === 'futures' ? state.futures.fundingRate : null,
      holdingTimeMs: Number(process.env.TRADING_EXPECTED_HOLDING_TIME_MS ?? 28_800_000),
    });
    base.costEstimate = costEstimate;
    if (!costEstimate.available) {
      base.authorizationReason = costEstimate.reason ?? 'COST_ASSUMPTIONS_UNAVAILABLE';
      base.reasons.push(base.authorizationReason);
      return base;
    }
    base.expectedValue = this.evService.calculate({
      winProbability: evProbability,
      probabilitySource: coldStart ? 'PAPER_COLD_START_AI' : 'CALIBRATED',
      expectedReward: target.expectedR,
      expectedLoss: 1,
      fee: costEstimate.feeCostR!,
      spread: costEstimate.spreadCostR!,
      slippage: costEstimate.slippageCostR!,
      funding: costEstimate.fundingCostR!,
      holdingTimeMs: Number(process.env.TRADING_EXPECTED_HOLDING_TIME_MS ?? 28_800_000),
      executionQuality: opportunity.executionQuality,
    });
    if (!base.expectedValue.available || base.expectedValue.netEV === null || base.expectedValue.netEV <= 0) {
      base.authorizationReason = base.expectedValue.reason ?? 'LOW_EDGE';
      base.reasons.push(base.authorizationReason);
      return base;
    }
    const equity = input.equity ?? input.account?.totalEquity;
    if (!Number.isFinite(equity) || !equity || equity <= 0) {
      base.authorizationReason = 'RISK_LIMIT';
      base.reasons.push(base.authorizationReason);
      return base;
    }
    const riskAmount = equity * (input.riskPerTrade ?? 0.01);
    const quantity = riskAmount / Math.abs(entry.preferredEntry - entry.stopLoss);
    const estimatedFees = this.costModel.estimatedFees(entry.preferredEntry, quantity, costEstimate.feeRate!);
    const estimatedSlippageUsd = this.costModel.estimatedSlippage(entry.preferredEntry, quantity, costEstimate.slippageFraction);
    const action = base.direction === 'LONG' ? 'BUY' : 'SELL';
    const account = input.account ?? this.defaultAccount(equity);
    const risk = this.riskEngine.evaluate({
      trade: {
        decisionId,
        symbol: state.symbol,
        action,
        entry: entry.preferredEntry,
        stopLoss: entry.stopLoss,
        takeProfit: target.price,
        requestedPositionSize: quantity,
        riskAmount,
        portfolioHeatBefore: input.portfolioHeatBefore ?? 0,
        symbolExposureBefore: input.symbolExposureBefore ?? 0,
        correlatedExposureBefore: input.correlatedExposureBefore ?? 0,
        leverage: 1,
        marginRequired: quantity * entry.preferredEntry,
        estimatedFees,
        estimatedSlippage: estimatedSlippageUsd,
        drawdown: account.currentDrawdown,
        dailyPnL: account.dailyPnL,
        dailyLossLimit: 0,
      },
      account,
      positions: input.positions ?? [],
      market: {
        spread: spread / price,
        liquidity: state.orderBook ? Math.min(1, (state.orderBook.bidDepth10 + state.orderBook.askDepth10) / Math.max(quantity * price, 1)) : 0,
        slippage: Math.max(state.orderBook?.estimatedBuySlippage ?? 0, state.orderBook?.estimatedSellSlippage ?? 0),
        stale: state.dataQuality.state !== 'HEALTHY',
        volatility: state.timeframes[alignment.entryTimeframe]?.volatility ?? 1,
      },
    });
    base.riskAssessment = risk;
    base.finalStatus = risk.approved ? (coldStart ? 'PAPER_COLD_START' : 'AUTHORIZED_FOR_PAPER') : 'REJECTED_BY_RISK';
    if (coldStart && risk.approved) base.reasons.push('PAPER_COLD_START');
    base.authorizationReason = risk.approved ? null : 'RISK_REJECTED';
    if (!risk.approved) base.reasons.push(base.authorizationReason ?? 'RISK_REJECTED');
    return base;
  }

  private latestStructure(state: CanonicalMarketState): StructureState | null {
    const timeframe = state.timeframes['5m'] ? '5m' : state.timeframes['15m'] ? '15m' : '1m';
    const existing = state.structure[timeframe];
    if (existing) return existing;
    const candles = state.candles[timeframe];
    if (!candles) return null;
    return this.structureService.analyze(state.symbol, timeframe, candles.map((candle) => ({
      timestamp: candle.closeTime,
      high: candle.high,
      low: candle.low,
      open: candle.open,
      close: candle.close,
      volume: candle.volume,
    })));
  }

  private hardGate(reasons: string[]): string | null {
    const precedence = ['DATA_INVALID', 'ORDERBOOK_INVALID', 'SEQUENCE_UNHEALTHY', 'EXECUTION_UNSAFE', 'RISK_LIMIT', 'STRUCTURE_INVALID', 'TIMEFRAME_CONFLICT', 'LOW_EDGE'];
    return precedence.find((reason) => reasons.includes(reason)) ?? null;
  }

  private unavailableEv(reason: string): ExpectedValueResult {
    return { available: false, grossEV: null, feeCost: null, spreadCost: null, slippageCost: null, fundingCost: null, netEV: null, reason };
  }

  private defaultAccount(equity: number): RiskEvaluationInput['account'] {
    return {
      totalEquity: equity, availableBalance: equity, marginUsed: 0, freeMargin: equity,
      unrealizedPnL: 0, realizedPnL: 0, leverage: 1, peakEquity: equity, currentDrawdown: 0,
      dailyPnL: 0, weeklyPnL: 0, consecutiveLosses: 0, tradingEnabled: true, killSwitch: false,
    };
  }
}
