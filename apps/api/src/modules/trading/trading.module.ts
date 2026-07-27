import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { TradingService } from './trading.service';
import { TradingController } from './trading.controller';

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [TradingService],
  controllers: [TradingController],
  exports: [TradingService],
})
export class TradingModule {}
