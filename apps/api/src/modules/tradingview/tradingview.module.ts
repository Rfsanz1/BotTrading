import { Module } from '@nestjs/common';
import { TradingviewController } from './tradingview.controller';
import { TradingviewService } from './tradingview.service';

@Module({
  controllers: [TradingviewController],
  providers: [TradingviewService],
  exports: [TradingviewService],
})
export class TradingviewModule {}
