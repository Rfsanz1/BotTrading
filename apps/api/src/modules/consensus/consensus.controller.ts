import { Controller, Get, Post, Param, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { ConsensusService } from './consensus.service';

@ApiTags('Consensus')
@Controller('consensus')
export class ConsensusController {
  constructor(private readonly consensusService: ConsensusService) {}

  /**
   * Build consensus from analyses
   */
  @Post('build/:alertId')
  @HttpCode(200)
  @ApiOperation({ summary: 'Build AI consensus from analyses' })
  @ApiResponse({ status: 200, description: 'Consensus built successfully' })
  async buildConsensus(
    @Param('alertId') alertId: string,
    @Body() body: { userId: string; symbol: string; analyses: any[] },
  ): Promise<{ ok: boolean; recommendation: string }> {
    const consensus = await this.consensusService.buildConsensus(alertId, body.userId, body.symbol, body.analyses);
    return { ok: true, recommendation: consensus.recommendation };
  }

  /**
   * Get consensus for alert
   */
  @Get(':alertId')
  @ApiOperation({ summary: 'Get consensus for alert' })
  @ApiResponse({ status: 200, description: 'Consensus retrieved' })
  async getConsensus(@Param('alertId') alertId: string): Promise<any> {
    return this.consensusService.getConsensus(alertId);
  }
}
