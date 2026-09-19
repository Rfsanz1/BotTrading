import { Module } from '@nestjs/common';
import { ExchangeCredentialService } from './exchange-credential.service';
import { LiveApprovalController } from './live-approval.controller';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  providers: [ExchangeCredentialService],
  exports: [ExchangeCredentialService],
  controllers: [LiveApprovalController],
})
export class CredentialsModule {}
