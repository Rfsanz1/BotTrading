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
import { BinanceMarketClient } from './collectors/binance-market-client';
import { DataQualityService } from './services/data-quality.service';
import { LocalOrderBookEngine } from './services/local-order-book.engine';
import { TradeFlowService } from './services/trade-flow.service';
import { CanonicalMarketCacheService } from './services/canonical-market-cache.service';
import { MarketStreamEventRouterService } from './services/market-stream-event-router.service';
import { BinanceMarketDataService } from './services/binance-market-data.service';
import { MultiTimeframeService } from './services/multi-timeframe.service';
import { RegimeService } from './services/regime.service';
import { OpportunityService } from './services/opportunity.service';
import { FuturesIntelligenceService } from './services/futures-intelligence.service';
import { LiquidationService } from './services/liquidation.service';
import { MarketAnalysisService } from './services/market-analysis.service';
import { MarketStructureService } from './services/market-structure.service';
import { AiValidationService } from './services/ai-validation.service';
import { ExpectedValueService } from './services/expected-value.service';
import { EntryExitService } from './services/entry-exit.service';
import { TradingDecisionPipelineService } from './services/trading-decision-pipeline.service';
import { PaperTradingService } from './services/paper-trading.service';
import { PaperOutcomePersistenceService } from './services/paper-outcome-persistence.service';
import { UniverseScannerService } from './services/universe-scanner.service';
import { MarketObservabilityService } from './services/market-observability.service';
import { RecoverySchedulerService } from './services/recovery-scheduler.service';
import { BinanceShardManagerService } from './services/binance-shard-manager.service';
import { PaperForwardValidationService } from './services/paper-forward-validation.service';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [EventEmitterModule.forRoot(), AnalysisModule],
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
    {
      provide: BinanceMarketClient,
      useFactory: () => new BinanceMarketClient(),
    },
    DataQualityService,
    LocalOrderBookEngine,
    TradeFlowService,
    LiquidationService,
    FuturesIntelligenceService,
    CanonicalMarketCacheService,
    MarketStreamEventRouterService,
    BinanceMarketDataService,
    MultiTimeframeService,
    RegimeService,
    OpportunityService,
    MarketAnalysisService,
    MarketStructureService,
    AiValidationService,
    ExpectedValueService,
    EntryExitService,
    TradingDecisionPipelineService,
    PaperTradingService,
    PaperForwardValidationService,
    PaperOutcomePersistenceService,
    UniverseScannerService,
    MarketObservabilityService,
    RecoverySchedulerService,
    BinanceShardManagerService,
    QuantitativeAnalysisGateway,
    {
      provide: 'MARKET_COLLECTORS',
      useFactory: (
        tradingView: TradingViewCollector,
        binance: BinanceCollector,
        bybit: BybitCollector,
        coinGecko: CoinGeckoCollector,
        fearGreed: FearGreedCollector,
        economicCalendar: EconomicCalendarCollector,
        orderBook: OrderBookCollector,
        openInterest: OpenInterestCollector,
        fundingRate: FundingRateCollector,
        liquidation: LiquidationCollector,
        volumeProfile: VolumeProfileCollector,
      ) => [
        tradingView,
        binance,
        bybit,
        coinGecko,
        fearGreed,
        economicCalendar,
        orderBook,
        openInterest,
        fundingRate,
        liquidation,
        volumeProfile,
      ],
      inject: [
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
      ],
    },
  ],
  exports: [
    MarketSyncService,
    MarketAggregatorService,
    SymbolRegistryService,
    TimeframeRegistryService,
    QuantitativeAnalysisService,
    PrismaService,
    BinanceMarketClient,
    PaperTradingService,
    UniverseScannerService,
    MarketObservabilityService,
  ],
})
export class MarketIntelligenceModule {}
