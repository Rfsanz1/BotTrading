import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { MarketSyncService } from './services/market-sync.service';
import { MarketAggregatorService } from './services/market-aggregator.service';
import { SymbolRegistryService } from './services/symbol-registry.service';
import { TimeframeRegistryService } from './services/timeframe-registry.service';
import { CollectMarketDto } from './dto/collect-market.dto';
import { MarketQueryDto } from './dto/market-query.dto';

@ApiTags('market-intelligence')
@Controller('market-intelligence')
export class MarketIntelligenceController {
  constructor(
    private readonly syncService: MarketSyncService,
    private readonly aggregator: MarketAggregatorService,
    private readonly symbols: SymbolRegistryService,
    private readonly timeframes: TimeframeRegistryService,
  ) {}

  @Post('collect')
  @ApiOperation({ summary: 'Trigger a market collection cycle' })
  @ApiResponse({ status: 201, description: 'Collection triggered' })
  async collect(@Body() dto: CollectMarketDto) {
    await this.syncService.sync(dto.symbols, dto.timeframes || ['1m', '5m', '1H']);
    return { ok: true };
  }

  @Get('symbols')
  async symbolsList() {
    return this.symbols.list();
  }

  @Get('timeframes')
  async timeframesList() {
    return this.timeframes.list();
  }

  @Get('snapshot/:symbol')
  async snapshot(@Param('symbol') string symbol, @Query() query: MarketQueryDto) {
    const timeframe = query.timeframe || '1H';
    return this.aggregator.getSnapshot(symbol, timeframe);
  }

  @Get('snapshots')
  async snapshots() {
    return this.aggregator.listSnapshots();
  }
}
