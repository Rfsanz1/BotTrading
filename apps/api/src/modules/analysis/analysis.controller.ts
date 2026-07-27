import { Controller, Get, Post, Param, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { AnalysisService } from '../services/analysis.service';
import { AnalysisResponseDto } from '../dto/analysis.dto';

@ApiTags('Analysis')
@Controller('analysis')
export class AnalysisController {
  constructor(private readonly analysisService: AnalysisService) {}

  /**
   * Trigger AI analysis for an alert
   */
  @Post('analyze/:alertId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Trigger AI analysis for alert' })
  @ApiResponse({ status: 200, description: 'Analysis started successfully' })
  async analyzeAlert(
    @Param('alertId') alertId: string,
    @Body() body: { userId: string; symbol: string; marketData?: Record<string, any> },
  ): Promise<{ ok: boolean; alertId: string }> {
    await this.analysisService.analyzeAlert(alertId, body.userId, body.symbol, body.marketData || {});
    return { ok: true, alertId };
  }

  /**
   * Get analysis results for an alert
   */
  @Get('results/:alertId')
  @ApiOperation({ summary: 'Get analysis results for alert' })
  @ApiResponse({ status: 200, description: 'Analysis results retrieved' })
  async getResults(@Param('alertId') alertId: string): Promise<AnalysisResponseDto> {
    const analyses = await this.analysisService.getAnalysisResults(alertId);
    return new AnalysisResponseDto(alertId, 'N/A', analyses);
  }

  /**
   * Get provider statistics
   */
  @Get('provider/:provider/stats')
  @ApiOperation({ summary: 'Get AI provider statistics' })
  @ApiResponse({ status: 200, description: 'Provider stats retrieved' })
  async getProviderStats(@Param('provider') provider: string): Promise<any> {
    return this.analysisService.getProviderStats(provider);
  }
}
