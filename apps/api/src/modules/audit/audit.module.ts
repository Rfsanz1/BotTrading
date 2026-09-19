import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AuditService } from './audit.service';
import { AuditController } from './audit.controller';

@Module({
  imports: [EventEmitterModule.forRoot()],
  providers: [AuditService],
  controllers: [AuditController],
  exports: [AuditService],
})
export class AuditModule {}
