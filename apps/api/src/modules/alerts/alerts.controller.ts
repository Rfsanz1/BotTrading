import { Controller, Post, Get, Param, Body, Req, HttpCode, UseGuards, Query } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { AlertService } from '../services/alert.service';
import { CreateAlertDto, AlertResponseDto, WebhookPayloadDto } from '../dto/alert.dto';

@ApiTags('Alerts')
@Controller('alerts')
export class AlertController {
  constructor(private readonly alertService: AlertService) {}

  /**
   * Receive TradingView webhook
   */
  @Post('webhook')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Receive TradingView webhook',
    description: 'Entry point for TradingView alerts. No authentication required.',
  })
  @ApiResponse({ status: 200, description: 'Webhook received successfully' })
  @ApiResponse({ status: 400, description: 'Invalid webhook payload' })
  async webhook(@Body() payload: Record<string, any>, @Req() req: any): Promise<{ id: string; ok: boolean }> {
    const webhookSource = req.headers['x-webhook-source'] || 'tradingview';
    const userId = req.user?.id || 'system'; // In real scenario, webhook would be user-specific

    const alertId = await this.alertService.handleWebhook(userId, payload, webhookSource);
    
    return {
      id: alertId,
      ok: true,
    };
  }

  /**
   * Get alert by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get alert by ID' })
  @ApiResponse({ status: 200, description: 'Alert found', type: AlertResponseDto })
  @ApiResponse({ status: 404, description: 'Alert not found' })
  async getAlert(@Param('id') alertId: string): Promise<AlertResponseDto> {
    const alert = await this.alertService.getAlert(alertId);
    return new AlertResponseDto(alert);
  }

  /**
   * Get user's alerts with pagination
   */
  @Get('user/list')
  @ApiOperation({ summary: 'Get user alerts' })
  @ApiResponse({ status: 200, description: 'Alerts retrieved successfully', type: [AlertResponseDto] })
  async getUserAlerts(
    @Query('userId') userId: string,
    @Query('limit') limit: number = 50,
    @Query('offset') offset: number = 0,
  ): Promise<AlertResponseDto[]> {
    const alerts = await this.alertService.getUserAlerts(userId, limit, offset);
    return alerts.map(alert => new AlertResponseDto(alert));
  }

  /**
   * Get alerts by symbol
   */
  @Get('symbol/:symbol')
  @ApiOperation({ summary: 'Get alerts by symbol' })
  @ApiResponse({ status: 200, description: 'Alerts retrieved successfully', type: [AlertResponseDto] })
  async getAlertsBySymbol(
    @Param('symbol') symbol: string,
    @Query('limit') limit: number = 50,
  ): Promise<AlertResponseDto[]> {
    const alerts = await this.alertService.getAlertsBySymbol(symbol, limit);
    return alerts.map(alert => new AlertResponseDto(alert));
  }

  /**
   * Get alerts by status
   */
  @Get('status/:status')
  @ApiOperation({ summary: 'Get alerts by status' })
  @ApiResponse({ status: 200, description: 'Alerts retrieved successfully', type: [AlertResponseDto] })
  async getAlertsByStatus(
    @Param('status') status: string,
    @Query('limit') limit: number = 50,
  ): Promise<AlertResponseDto[]> {
    const alerts = await this.alertService.getAlertsByStatus(status, limit);
    return alerts.map(alert => new AlertResponseDto(alert));
  }

  /**
   * Validate an alert
   */
  @Post(':id/validate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Validate alert webhook' })
  @ApiResponse({ status: 200, description: 'Alert validated successfully' })
  @ApiResponse({ status: 404, description: 'Alert not found' })
  async validateAlert(@Param('id') alertId: string): Promise<{ ok: boolean }> {
    await this.alertService.validateAlert(alertId);
    return { ok: true };
  }

  /**
   * Start processing alert
   */
  @Post(':id/process')
  @HttpCode(200)
  @ApiOperation({ summary: 'Start processing alert' })
  @ApiResponse({ status: 200, description: 'Alert processing started' })
  @ApiResponse({ status: 404, description: 'Alert not found' })
  async startProcessing(@Param('id') alertId: string): Promise<{ ok: boolean }> {
    await this.alertService.startProcessing(alertId);
    return { ok: true };
  }

  /**
   * Update alert status
   */
  @Post(':id/status')
  @HttpCode(200)
  @ApiOperation({ summary: 'Update alert status' })
  @ApiResponse({ status: 200, description: 'Alert status updated' })
  @ApiResponse({ status: 404, description: 'Alert not found' })
  async updateStatus(
    @Param('id') alertId: string,
    @Body() body: { status: string },
  ): Promise<AlertResponseDto> {
    const alert = await this.alertService.updateAlertStatus(alertId, body.status);
    return new AlertResponseDto(alert);
  }
}
