import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AnalysisService } from './services/analysis.service';
import { AnalysisController } from './analysis.controller';
import { AnalysisRepository } from './repositories/analysis.repository';
import {
  OpenAIProvider,
  ClaudeProvider,
  GeminiProvider,
  GroqProvider,
  DeepSeekProvider,
  OllamaProvider,
} from './providers/ai-providers';

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [
    AnalysisService,
    AnalysisRepository,
    OpenAIProvider,
    ClaudeProvider,
    GeminiProvider,
    GroqProvider,
    DeepSeekProvider,
    OllamaProvider,
  ],
  controllers: [AnalysisController],
  exports: [AnalysisService],
})
export class AnalysisModule {}
