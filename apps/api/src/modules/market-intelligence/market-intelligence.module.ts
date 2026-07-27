import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../common/redis.service';
import { TradingViewCollector } from './collectors/tradingview.collector';
import { BinanceCollector } from './collectors/binance.collector';
import { BybitCollector } from './collectors/bybit.collector';
import { CoinGeckoCollector } from './collectors/coingecko.collector';
import { FearGreedCollector } from './collectors/fear-greed.collector';
import { EconomicCalendarCollector } from './collectors/economic-calendar.collector';
import { OrderBookCollector } from './collectors/orderbook.collector';
import { OpenInterestCollector } from './collectors/open-interest.collector';
import { FundingRateCollector } from './collectors/funding-rate.collector';
import { LiquidationCollector } from './collectors/liquidations.collector';
import { VolumeProfileCollector } from './collectors/volume-profile.collector';
import { SymbolRegistryService } from './services/symbol-registry.service';
import { TimeframeRegistryService } from './services/timeframe-registry.service';
import { MarketAggregatorService } from './services/market-aggregator.service';
import { MarketSyncService } from './services/market-sync.service';
import { MarketRepository } from './repositories/market-repository';
import { MarketIntelligenceController } from './market-intelligence.controller';
import { MarketIntelligenceGateway } from './market-intelligence.gateway';
import { MarketIntelligenceScheduler } from './market-intelligence.scheduler';
import { QuantitativeAnalysisController } from './quantitative-analysis.controller';
import { QuantitativeAnalysisGateway } from './quantitative-analysis.gateway';
import { QuantitativeAnalysisRepository } from './quantitative-analysis.repository';
import { QuantitativeAnalysisService } from './services/quantitative-analysis.service';

@Module({
  imports: [EventEmitterModule.forRoot()],
  controllers: [MarketIntelligenceController, QuantitativeAnalysisController],
  providers: [
    PrismaService,
    RedisService,
    TradingViewCollector,
    BinanceCollector,
    BybitCollector,
    CoinGeckoCollector,
    FearGreedCollector,
    EconomicCalendarCollector,
    OrderBookCollector,
    OpenInterestCollector,
    FundingRateCollector,
    LiquidationCollector,
    VolumeProfileCollector,
    SymbolRegistryService,
    TimeframeRegistryService,
    MarketAggregatorService,
    MarketSyncService,
    MarketRepository,
    MarketIntelligenceGateway,
    MarketIntelligenceScheduler,
    QuantitativeAnalysisService,
    QuantitativeAnalysisRepository,
    QuantitativeAnalysisGateway,
  ],
  exports: [MarketSyncService, MarketAggregatorService, SymbolRegistryService, TimeframeRegistryService, QuantitativeAnalysisService],
})
export class MarketIntelligenceModule {}
