import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CanonicalMarketState } from '../interfaces/canonical-market.interface';
import { TradingDecision } from './trading-decision-pipeline.service';
import { PaperTradingService } from './paper-trading.service';

@Injectable()
export class PaperForwardValidationService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PaperForwardValidationService.name);
  private readonly onAnalysis = (payload: { decision?: TradingDecision }) => {
    if (payload.decision?.finalStatus === 'AUTHORIZED_FOR_PAPER') {
      try {
        this.paper.authorize(payload.decision);
      } catch (error) {
        this.logger.warn(`Paper authorization rejected: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
  private readonly onMarketUpdate = (payload: { state?: CanonicalMarketState }) => {
    const state = payload.state;
    if (!state?.lastUpdate || state.lastUpdate <= 0) return;
    for (const order of this.paper.list().filter((item) => item.status === 'AUTHORIZED' || item.status === 'FILLED')) {
      if (order.symbol !== state.symbol || order.marketType !== state.marketType) continue;
      try {
        if (order.status === 'AUTHORIZED' && state.bid !== null && state.ask !== null && state.lastUpdate > order.decisionAt) {
          this.paper.fill(order.id, {
            bid: state.bid,
            ask: state.ask,
            slippage: state.orderBook?.estimatedBuySlippage ?? state.orderBook?.estimatedSellSlippage ?? 0,
            timestamp: state.lastUpdate,
          });
        }
        if (order.status === 'FILLED' && state.bid !== null && state.ask !== null) {
          const candle = state.formingCandles['1m'];
          this.paper.mark(order.id, {
            bid: state.bid,
            ask: state.ask,
            high: candle?.high,
            low: candle?.low,
            slippage: state.orderBook?.estimatedBuySlippage ?? state.orderBook?.estimatedSellSlippage ?? 0,
            timestamp: state.lastUpdate,
          });
        }
      } catch (error) {
        this.logger.warn(`Paper forward update rejected: order=${order.id} error=${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  constructor(
    private readonly events: EventEmitter2,
    private readonly paper: PaperTradingService,
  ) {}

  onModuleInit(): void {
    this.events.on('market.analysis.updated', this.onAnalysis);
    this.events.on('market.canonical.updated', this.onMarketUpdate);
  }

  onModuleDestroy(): void {
    this.events.off('market.analysis.updated', this.onAnalysis);
    this.events.off('market.canonical.updated', this.onMarketUpdate);
  }
}
