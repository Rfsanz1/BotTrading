import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TradingService } from './trading.service';
import { TradingController } from './trading.controller';
import { TradingEventHandlers } from './event-handlers';
import { SymbolValidator } from '@rfsanz/exchange/src/services/symbol-validator.service';
import { PositionService } from '@rfsanz/exchange/src/services/position.service';
import { BalanceSyncService } from '@rfsanz/exchange/src/services/balance-sync.service';
import { PnLCalculationService } from '@rfsanz/exchange/src/services/pnl-calculation.service';

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [
    TradingService,
    TradingEventHandlers,
    SymbolValidator,
    PositionService,
    BalanceSyncService,
    PnLCalculationService,
  ],
  controllers: [TradingController],
  exports: [TradingService],
})
export class TradingModule {}
