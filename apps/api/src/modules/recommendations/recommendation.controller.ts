import { Controller, Get, Post, Param, Body, HttpCode } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { RecommendationService } from './recommendation.service';

@ApiTags('Recommendations')
@Controller('recommendations')
export class RecommendationController {
  constructor(private readonly recommendationService: RecommendationService) {}

  /**
   * Generate recommendation
   */
  @Post('generate')
  @HttpCode(201)
  @ApiOperation({ summary: 'Generate trading recommendation' })
  @ApiResponse({ status: 201, description: 'Recommendation generated successfully' })
  async generateRecommendation(
    @Body() body: any,
  ): Promise<{ id: string; ok: boolean }> {
    const recommendationId = await this.recommendationService.generate(body);
    return { id: recommendationId, ok: true };
  }

  /**
   * Get recommendation by ID
   */
  @Get(':id')
  @ApiOperation({ summary: 'Get recommendation by ID' })
  @ApiResponse({ status: 200, description: 'Recommendation found' })
  async getRecommendation(@Param('id') id: string): Promise<any> {
    return this.recommendationService.getRecommendation(id);
  }

  /**
   * Get user's recommendations
   */
  @Get('user/:userId')
  @ApiOperation({ summary: 'Get user recommendations' })
  @ApiResponse({ status: 200, description: 'Recommendations retrieved' })
  async getUserRecommendations(
    @Param('userId') userId: string,
  ): Promise<any[]> {
    return this.recommendationService.getUserRecommendations(userId);
  }

  /**
   * Approve recommendation
   */
  @Post(':id/approve')
  @HttpCode(200)
  @ApiOperation({ summary: 'Approve recommendation' })
  @ApiResponse({ status: 200, description: 'Recommendation approved' })
  async approveRecommendation(@Param('id') id: string): Promise<{ ok: boolean }> {
    await this.recommendationService.approveRecommendation(id);
    return { ok: true };
  }

  /**
   * Reject recommendation
   */
  @Post(':id/reject')
  @HttpCode(200)
  @ApiOperation({ summary: 'Reject recommendation' })
  @ApiResponse({ status: 200, description: 'Recommendation rejected' })
  async rejectRecommendation(
    @Param('id') id: string,
    @Body() body?: { reason?: string },
  ): Promise<{ ok: boolean }> {
    await this.recommendationService.rejectRecommendation(id, body?.reason);
    return { ok: true };
  }
}
