import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { PinoLogger } from './common/logger.service';
import { HealthModule } from './modules/health/health.module';
import { TradingviewModule } from './modules/tradingview/tradingview.module';
import { AlertsModule } from './modules/alerts/alerts.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { ConsensusModule } from './modules/consensus/consensus.module';
import { RecommendationsModule } from './modules/recommendations/recommendation.module';
import { TradingModule } from './modules/trading/trading.module';
import { NotificationsModule } from './modules/notifications/notification.module';
import { AuditModule } from './modules/audit/audit.module';
import { WorkflowModule } from './modules/workflow/workflow.module';
import { MarketIntelligenceModule } from './modules/market-intelligence/market-intelligence.module';
import { ResearchModule } from './modules/research/research.module';

@Module({
  imports: [
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    AuthModule,
    UsersModule,
    HealthModule,
    TradingviewModule,
    AlertsModule,
    AnalysisModule,
    ConsensusModule,
    RecommendationsModule,
    TradingModule,
    NotificationsModule,
    AuditModule,
    WorkflowModule,
    MarketIntelligenceModule,
    ResearchModule,
  ],
  controllers: [],
  providers: [
    PinoLogger,
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: ResponseInterceptor },
  ],
})
export class AppModule {}

export default AppModule;
