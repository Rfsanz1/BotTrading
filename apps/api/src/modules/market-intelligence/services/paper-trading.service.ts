import { Injectable } from '@nestjs/common';
import { TradingDecision } from './trading-decision-pipeline.service';
import { Optional } from '@nestjs/common';
import { PaperOutcomePersistenceService } from './paper-outcome-persistence.service';

export type PaperOrderStatus = 'CREATED' | 'AUTHORIZED' | 'OPEN' | 'PARTIALLY_FILLED' | 'FILLED' | 'CANCELLED' | 'REJECTED' | 'CLOSED';
export interface PaperOrder {
  id: string;
  symbol: string;
  marketType: 'spot' | 'futures';
  direction: 'LONG' | 'SHORT';
  status: PaperOrderStatus;
  quantity: number;
  filledQuantity: number;
  entry: number;
  averageFill: number | null;
  stopLoss: number;
  tp1: number;
  tp2: number | null;
  tp3: number | null;
  fees: number;
  slippage: number;
  openedAt: number | null;
  closedAt: number | null;
  realizedPnL: number;
  mfe: number;
  mae: number;
  decisionId: string;
  provider: string | null;
  model: string | null;
  confidenceRaw: number | null;
  calibratedProbability: number | null;
  opportunityScore: number;
  regime: string;
  setupType: string;
  timeframe: string;
  decisionAt: number;
  expectedRiskReward: number;
  spread: number;
  feeRate: number;
  exitReason: string | null;
  grossPnL: number;
  lastMarketTimestamp: number | null;
  timeoutAt: number | null;
  riskAmount: number;
}

@Injectable()
export class PaperTradingService {
  private readonly orders = new Map<string, PaperOrder>();

  constructor(@Optional() private readonly persistence?: PaperOutcomePersistenceService) {}

  authorize(decision: TradingDecision): PaperOrder {
    if (decision.finalStatus !== 'AUTHORIZED_FOR_PAPER' || !decision.entry?.stopLoss || !decision.entry.tp1 || !decision.riskAssessment?.approved) {
      throw new Error('Paper authorization requires an approved final decision');
    }
    const id = `paper-${decision.decisionId}`;
    const order: PaperOrder = {
      id, symbol: decision.symbol, marketType: decision.marketType, direction: decision.direction as 'LONG' | 'SHORT',
      status: 'AUTHORIZED', quantity: decision.riskAssessment.approvedPositionSize, filledQuantity: 0,
      entry: decision.entry.preferredEntry, averageFill: null, stopLoss: decision.entry.stopLoss,
      tp1: decision.entry.tp1.price, tp2: decision.entry.tp2?.price ?? null, tp3: decision.entry.tp3?.price ?? null,
      fees: 0, slippage: 0, openedAt: null, closedAt: null, realizedPnL: 0, mfe: 0, mae: 0,
      decisionId: decision.decisionId,
      provider: decision.aiValidation ? 'existing-ai' : null,
      model: decision.aiValidation ? 'existing-model' : null,
      confidenceRaw: decision.confidenceRaw,
      calibratedProbability: decision.calibratedProbability,
      opportunityScore: decision.opportunityScore,
      regime: decision.regime.regime,
      setupType: decision.setupType,
      timeframe: decision.alignment.entryTimeframe,
      decisionAt: decision.timestamp,
      expectedRiskReward: decision.entry.tp1.expectedR,
      spread: decision.entry.entryZone.high - decision.entry.entryZone.low,
      feeRate: 0.0004,
      exitReason: null,
      grossPnL: 0,
      lastMarketTimestamp: null,
      timeoutAt: decision.timestamp + Number(process.env.PAPER_TRADE_TIMEOUT_MS ?? 86_400_000),
      riskAmount: Math.abs(decision.entry.preferredEntry - decision.entry.stopLoss) * decision.riskAssessment.approvedPositionSize,
    };
    this.orders.set(id, order);
    if (this.persistence && decision.aiValidation) {
      void this.persistence.recordPrediction({
        decisionId: decision.decisionId,
        symbol: decision.symbol,
        marketType: decision.marketType,
        provider: order.provider!,
        model: order.model!,
        direction: decision.direction,
        setupType: decision.setupType,
        timeframe: decision.alignment.entryTimeframe,
        confidenceRaw: decision.confidenceRaw ?? 0,
        calibratedProbability: decision.calibratedProbability,
        regime: decision.regime.regime,
        opportunityScore: decision.opportunityScore,
        decisionTimestamp: decision.timestamp,
        entryPrice: decision.entry.preferredEntry,
        stopLoss: decision.entry.stopLoss,
        takeProfit: decision.entry.tp1.price,
        riskReward: decision.entry.tp1.expectedR,
        spread: decision.entry.entryZone.high - decision.entry.entryZone.low,
        dataQuality: decision.dataQuality,
        signalFactors: { reasons: decision.opportunity.noTradeReasons, warnings: decision.warnings },
        strategyVersion: 'paper-forward-v1',
      });
    }
    return order;
  }

  fill(id: string, market: { bid: number; ask: number; slippage: number; feeRate?: number; timestamp?: number }): PaperOrder {
    const order = this.require(id);
    if (order.status !== 'AUTHORIZED' && order.status !== 'OPEN') throw new Error('Paper order is not fillable');
    const timestamp = market.timestamp ?? Date.now();
    if (timestamp <= order.decisionAt) throw new Error('Paper fill must occur after decision timestamp');
    const fill = order.direction === 'LONG' ? market.ask + market.slippage : market.bid - market.slippage;
    const feeRate = market.feeRate ?? order.feeRate;
    const fee = Math.abs(fill * order.quantity * feeRate);
    order.averageFill = fill;
    order.filledQuantity = order.quantity;
    order.fees += fee;
    order.slippage += Math.abs(market.slippage);
    order.openedAt = timestamp;
    order.lastMarketTimestamp = timestamp;
    order.feeRate = feeRate;
    order.status = 'FILLED';
    return order;
  }

  mark(id: string, market: {
    bid: number;
    ask: number;
    timestamp?: number;
    high?: number;
    low?: number;
    feeRate?: number;
    slippage?: number;
  }): PaperOrder {
    const order = this.require(id);
    if (!order.averageFill || order.status === 'CLOSED') return order;
    const timestamp = market.timestamp ?? Date.now();
    if (timestamp <= (order.lastMarketTimestamp ?? order.decisionAt)) return order;
    order.lastMarketTimestamp = timestamp;
    const price = (market.bid + market.ask) / 2;
    const high = market.high ?? Math.max(market.bid, market.ask);
    const low = market.low ?? Math.min(market.bid, market.ask);
    const exitFeeRate = market.feeRate ?? order.feeRate;
    const exitSlippage = Math.abs(market.slippage ?? 0);
    const signed = order.direction === 'LONG' ? price - order.averageFill : order.averageFill - price;
    order.mfe = Math.max(order.mfe, signed);
    order.mae = Math.min(order.mae, signed);
    const stopHit = order.direction === 'LONG' ? low <= order.stopLoss : high >= order.stopLoss;
    const targetHit = order.direction === 'LONG' ? high >= order.tp1 : low <= order.tp1;
    const timeout = order.timeoutAt !== null && timestamp >= order.timeoutAt;
    // If both barriers occur in one observation, stop wins conservatively because
    // candle sequencing is unknowable without tick-level ordering.
    if (stopHit) this.close(order, order.stopLoss, timestamp, 'STOP_LOSS', exitFeeRate, exitSlippage);
    else if (targetHit) this.close(order, order.tp1, timestamp, 'TAKE_PROFIT', exitFeeRate, exitSlippage);
    else if (timeout) this.close(order, price, timestamp, 'TIMEOUT', exitFeeRate, exitSlippage);
    return order;
  }

  get(id: string): PaperOrder | undefined { return this.orders.get(id); }
  list(): PaperOrder[] { return [...this.orders.values()]; }

  metrics() {
    const orders = this.list();
    const closed = orders.filter((order) => order.status === 'CLOSED');
    const wins = closed.filter((order) => order.realizedPnL > 0);
    const grossProfit = wins.reduce((sum, order) => sum + order.realizedPnL, 0);
    const grossLoss = Math.abs(closed.filter((order) => order.realizedPnL < 0)
      .reduce((sum, order) => sum + order.realizedPnL, 0));
    const netPnL = closed.reduce((sum, order) => sum + order.realizedPnL, 0);
    return {
      paperOrders: orders.length,
      paperFills: orders.filter((order) => order.status !== 'AUTHORIZED').length,
      paperClosedTrades: closed.length,
      wins: wins.length,
      losses: closed.filter((order) => order.realizedPnL < 0).length,
      timeout: closed.filter((order) => order.exitReason === 'TIMEOUT').length,
      unresolved: orders.filter((order) => order.status === 'FILLED' || order.status === 'OPEN').length,
      winRate: closed.length ? wins.length / closed.length : null,
      profitFactor: grossLoss ? grossProfit / grossLoss : null,
      expectancy: closed.length ? netPnL / closed.length : null,
      averageR: closed.length ? closed.reduce((sum, order) => sum + order.realizedPnL / Math.max(order.riskAmount, Number.EPSILON), 0) / closed.length : null,
      netPnL,
      grossPnL: closed.reduce((sum, order) => sum + order.grossPnL, 0),
      fees: orders.reduce((sum, order) => sum + order.fees, 0),
      slippage: orders.reduce((sum, order) => sum + order.slippage, 0),
      maxDrawdown: this.calculateMaxDrawdown(closed.map((order) => order.realizedPnL)),
    };
  }

  private require(id: string): PaperOrder {
    const order = this.orders.get(id);
    if (!order) throw new Error(`Unknown paper order: ${id}`);
    return order;
  }

  private calculateMaxDrawdown(pnls: number[]): number {
    let equity = 0;
    let peak = 0;
    let drawdown = 0;
    for (const pnl of pnls) {
      equity += pnl;
      peak = Math.max(peak, equity);
      drawdown = Math.min(drawdown, equity - peak);
    }
    return Math.abs(drawdown);
  }

  private async persistOutcome(order: PaperOrder, exitReason: string): Promise<void> {
    if (!this.persistence) return;
    await this.persistence.recordOutcome({
      decisionId: order.decisionId,
      entryPrice: order.averageFill ?? order.entry,
      exitPrice: order.averageFill ?? order.entry + order.realizedPnL / Math.max(order.filledQuantity, 1),
      realizedPnL: order.realizedPnL,
      returnPct: order.realizedPnL / Math.max(order.riskAmount, Number.EPSILON),
      mfe: order.mfe,
      mae: order.mae,
      holdingTime: (order.closedAt ?? Date.now()) - (order.openedAt ?? Date.now()),
      fees: order.fees,
      slippage: order.slippage,
      fundingCost: 0,
      exitReason,
      winLoss: order.realizedPnL > 0 ? 'win' : order.realizedPnL < 0 ? 'loss' : 'neutral',
      closedAt: order.closedAt ?? Date.now(),
    });
  }

  private close(order: PaperOrder, exitPrice: number, timestamp: number, reason: string, feeRate: number, slippage: number): void {
    const adjustedExit = order.direction === 'LONG' ? exitPrice - slippage : exitPrice + slippage;
    const gross = (order.direction === 'LONG' ? adjustedExit - order.averageFill! : order.averageFill! - adjustedExit) * order.filledQuantity;
    const exitFee = Math.abs(adjustedExit * order.filledQuantity * feeRate);
    order.grossPnL = gross;
    order.fees += exitFee;
    order.slippage += slippage;
    order.realizedPnL = gross - order.fees;
    order.exitReason = reason;
    order.status = 'CLOSED';
    order.closedAt = timestamp;
    void this.persistOutcome(order, reason);
  }
}
