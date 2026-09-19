import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AlertService } from './services/alert.service';
import { AlertController } from './alerts.controller';
import { AlertRepository } from './repositories/alert.repository';

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [AlertService, AlertRepository],
  controllers: [AlertController],
  exports: [AlertService],
})
export class AlertsModule {}
