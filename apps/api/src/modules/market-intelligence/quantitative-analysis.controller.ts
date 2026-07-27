import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { QuantitativeAnalysisService } from './services/quantitative-analysis.service';

class CalculateIndicatorsDto {
  symbol!: string;
  timeframe!: string;
  exchange!: string;
  candles!: Array<{
    timestamp: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>;
}

@ApiTags('quantitative-analysis')
@Controller('quantitative-analysis')
export class QuantitativeAnalysisController {
  constructor(private readonly service: QuantitativeAnalysisService) {}

  @Post('calculate')
  @ApiOperation({ summary: 'Calculate reusable quantitative indicators for a candle series' })
  @ApiResponse({ status: 201, description: 'Indicators calculated' })
  async calculate(@Body() dto: CalculateIndicatorsDto) {
    return this.service.calculate(dto.symbol, dto.timeframe, dto.exchange, dto.candles);
  }

  @Get('health')
  async health() {
    return { ok: true, service: 'quantitative-analysis' };
  }

  @Get(':symbol/:timeframe/:exchange')
  async getIndicators(@Param('symbol') symbol: string, @Param('timeframe') timeframe: string, @Param('exchange') exchange: string, @Query('candles') candlesJson?: string) {
    const candles = candlesJson ? JSON.parse(candlesJson) : [];
    return this.service.calculate(symbol, timeframe, exchange, candles);
  }
}
