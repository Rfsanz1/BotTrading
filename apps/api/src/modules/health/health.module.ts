import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';
import { PaperOperationalService } from './paper-operational.service';
import { MarketIntelligenceModule } from '../market-intelligence/market-intelligence.module';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [MarketIntelligenceModule, AnalysisModule],
  controllers: [HealthController],
  providers: [
    PaperOperationalService,
  ],
  exports: [PaperOperationalService],
})
export class HealthModule {}

export default HealthModule;
