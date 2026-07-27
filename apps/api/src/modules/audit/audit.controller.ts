import { Controller, Get, Post, Param, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AuditService } from './audit.service';

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
  async log(@Body() body: any): Promise<{ ok: boolean }> {
    await this.auditService.log(body);
    return { ok: true };
  }

  /**
   * Log error
   */
  @Post('log-error')
  @HttpCode(201)
  @ApiOperation({ summary: 'Log error' })
  @ApiResponse({ status: 201, description: 'Error logged' })
  async logError(@Body() body: any): Promise<{ ok: boolean }> {
    await this.auditService.logError(body);
    return { ok: true };
  }

  /**
   * Get user logs
   */
  @Get('user/:userId')
  @ApiOperation({ summary: 'Get user audit logs' })
  @ApiResponse({ status: 200, description: 'Logs retrieved' })
  async getUserLogs(@Param('userId') userId: string): Promise<any[]> {
    return this.auditService.getUserLogs(userId);
  }

  /**
   * Get logs by action
   */
  @Get('action/:action')
  @ApiOperation({ summary: 'Get logs by action' })
  @ApiResponse({ status: 200, description: 'Logs retrieved' })
  async getLogsByAction(@Param('action') action: string): Promise<any[]> {
    return this.auditService.getLogsByAction(action);
  }

  /**
   * Get AI provider stats
   */
  @Get('ai-provider/:provider')
  @ApiOperation({ summary: 'Get AI provider statistics' })
  @ApiResponse({ status: 200, description: 'Stats retrieved' })
  async getAIProviderStats(@Param('provider') provider: string): Promise<any> {
    return this.auditService.getAIProviderStats(provider);
  }

  /**
   * Generate trading report
   */
  @Get('report/:userId')
  @ApiOperation({ summary: 'Generate trading report' })
  @ApiResponse({ status: 200, description: 'Report generated' })
  async generateReport(@Param('userId') userId: string): Promise<any> {
    return this.auditService.generateTradingReport(userId);
  }
}
