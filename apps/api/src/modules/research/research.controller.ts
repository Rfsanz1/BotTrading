import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ResearchService } from './services/research.service';
import { ResearchQueueService } from './services/research-queue.service';

@ApiTags('research')
@Controller('research')
export class ResearchController {
  constructor(
    private readonly service: ResearchService,
    private readonly queue: ResearchQueueService,
  ) {}

  @Post('run')
  @ApiOperation({ summary: 'Run research for a symbol' })
  @ApiResponse({ status: 201, description: 'Research completed' })
  async run(@Body() body: { symbol: string; timeframe: string; exchange: string }) {
    return this.service.runResearch(body.symbol, body.timeframe, body.exchange);
  }

  @Post('queue')
  @ApiOperation({ summary: 'Queue research for a symbol' })
  async queue(@Body() body: { symbol: string; timeframe: string; exchange: string }) {
    await this.queue.enqueue(body.symbol, body.timeframe, body.exchange);
    return { ok: true };
  }

  @Get('history/:symbol')
  async history(@Param('symbol') symbol: string) {
    return this.service.getHistory(symbol);
  }

  @Get(':symbol/:timeframe/:exchange')
  async latest(@Param('symbol') symbol: string, @Param('timeframe') timeframe: string, @Param('exchange') exchange: string) {
    return this.service.getLatest(symbol, timeframe, exchange);
  }
}
