import { Controller, Get, Post, Param, Body, HttpCode, Req } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuditService } from './audit.service';
import { requireAdminScope, requireUserScope } from '../../common/user-scope';

@ApiTags('Audit & Logging')
@Controller('audit')
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  /**
   * Log action
   */
  @Post('log')
  @HttpCode(201)
  @ApiOperation({ summary: 'Record audit log' })
  @ApiResponse({ status: 201, description: 'Audit log recorded' })
  async log(@Body() body: any, @Req() req: any): Promise<{ ok: boolean }> {
    const targetUserId = await requireUserScope(req, body.userId);
    const actorUserId = req.user.id;
    await this.auditService.log({ ...body, userId: targetUserId, ipAddress: req.ip }, actorUserId);
    return { ok: true };
  }

  /**
   * Log error
   */
  @Post('log-error')
  @HttpCode(201)
  @ApiOperation({ summary: 'Log error' })
  @ApiResponse({ status: 201, description: 'Error logged' })
  async logError(@Body() body: any, @Req() req: any): Promise<{ ok: boolean }> {
    const targetUserId = await requireUserScope(req, body.userId);
    const actorUserId = req.user.id;
    await this.auditService.logError({ ...body, userId: targetUserId, ipAddress: req.ip }, actorUserId);
    return { ok: true };
  }

  /**
   * Get user logs
   */
  @Get('user/:userId')
  @ApiOperation({ summary: 'Get user audit logs' })
  @ApiResponse({ status: 200, description: 'Logs retrieved' })
  async getUserLogs(@Param('userId') userId: string, @Req() req: any): Promise<any[]> {
    return this.auditService.getUserLogs(await requireUserScope(req, userId));
  }

  /**
   * Get logs by action
   */
  @Get('action/:action')
  @ApiOperation({ summary: 'Get logs by action' })
  @ApiResponse({ status: 200, description: 'Logs retrieved' })
  async getLogsByAction(@Param('action') action: string, @Req() req: any): Promise<any[]> {
    await requireAdminScope(req);
    return this.auditService.getLogsByAction(action);
  }

  /**
   * Get AI provider stats
   */
  @Get('ai-provider/:provider')
  @ApiOperation({ summary: 'Get AI provider statistics' })
  @ApiResponse({ status: 200, description: 'Stats retrieved' })
  async getAIProviderStats(@Param('provider') provider: string, @Req() req: any): Promise<any> {
    await requireAdminScope(req);
    return this.auditService.getAIProviderStats(provider);
  }

  /**
   * Generate trading report
   */
  @Get('report/:userId')
  @ApiOperation({ summary: 'Generate trading report' })
  @ApiResponse({ status: 200, description: 'Report generated' })
  async generateReport(@Param('userId') userId: string, @Req() req: any): Promise<any> {
    return this.auditService.generateTradingReport(await requireUserScope(req, userId));
  }
}
