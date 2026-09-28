import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AnalysisService } from './services/analysis.service';
import { AnalysisController } from './analysis.controller';
import { AnalysisRepository } from './repositories/analysis.repository';
import { AIModule } from '@rfsanz/ai/router-production';

@Module({
  imports: [EventEmitterModule.forRoot(), AIModule.register()],
  providers: [
    AnalysisService,
    AnalysisRepository,
  ],
  controllers: [AnalysisController],
  exports: [AnalysisService],
})
export class AnalysisModule {}
