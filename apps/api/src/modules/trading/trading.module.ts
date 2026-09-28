import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AnalysisModule } from '../analysis/analysis.module';
import { MarketIntelligenceModule } from '../market-intelligence/market-intelligence.module';
import { TradingService } from './trading.service';
import { TradingLifecycleService } from './trading-lifecycle.service';
import { TradingController } from './trading.controller';
import { TradingEventHandlers } from './event-handlers';
import { PaperSmokeService } from './paper-smoke.service';
import { PaperFailureService } from './paper-failure.service';
import { KillSwitchController } from './kill-switch.controller';
import {
  SymbolValidator,
  PositionService,
  BalanceSyncService,
  PnLCalculationService,
} from '@rfsanz/exchange';

@Module({
  imports: [EventEmitterModule.forRoot(), AnalysisModule, MarketIntelligenceModule],
  providers: [
    TradingService,
    TradingLifecycleService,
    TradingEventHandlers,
    PaperSmokeService,
    PaperFailureService,
    SymbolValidator,
    PositionService,
    BalanceSyncService,
    PnLCalculationService,
  ],
  controllers: [TradingController, KillSwitchController],
  exports: [TradingService],
})
export class TradingModule {}
