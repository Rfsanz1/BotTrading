import { Body, Controller, Delete, Get, Post, Req } from '@nestjs/common';
import { AuditService } from '../audit/audit.service';
import { requireAdminScope } from '../../common/user-scope';
import {
  armLiveApproval,
  getLiveApproval,
  revokeLiveApproval,
} from '@rfsanz/exchange';

class ArmLiveApprovalDto {
  accountId!: string;
  riskConfigVersion!: string;
  ttlMs?: number;
}

@Controller('admin/live-approval')
export class LiveApprovalController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  async status(@Req() req: any) {
    await requireAdminScope(req);
    return { active: Boolean(getLiveApproval()) };
  }

  @Post('arm')
  async arm(@Body() body: ArmLiveApprovalDto, @Req() req: any) {
    const operatorUserId = await requireAdminScope(req);
    const approval = armLiveApproval({
      operatorUserId,
      accountId: body.accountId,
      riskConfigVersion: body.riskConfigVersion,
      ttlMs: body.ttlMs,
    });
    await this.audit.logSystem({
      userId: operatorUserId,
      action: 'LIVE_APPROVAL_ARMED',
      resource: approval.accountId,
      changes: {
        approvalId: approval.approvalId,
        mode: approval.mode,
        expiresAt: approval.expiresAt,
        riskConfigVersion: approval.riskConfigVersion,
      },
      ipAddress: req.ip,
    });
    return { active: true, approvalId: approval.approvalId, expiresAt: approval.expiresAt };
  }

  @Delete()
  async revoke(@Req() req: any) {
    const operatorUserId = await requireAdminScope(req);
    revokeLiveApproval();
    await this.audit.logSystem({
      userId: operatorUserId,
      action: 'LIVE_APPROVAL_REVOKED',
      resource: 'LIVE',
      changes: { mode: 'LIVE' },
      ipAddress: req.ip,
    });
    return { active: false };
  }
}
