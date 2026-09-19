import { Test } from '@nestjs/testing';
import { MarketIntelligenceController } from '../market-intelligence.controller';
import { MarketSyncService } from '../services/market-sync.service';
import { MarketAggregatorService } from '../services/market-aggregator.service';
import { SymbolRegistryService } from '../services/symbol-registry.service';
import { TimeframeRegistryService } from '../services/timeframe-registry.service';

describe('MarketIntelligenceController', () => {
  let controller: MarketIntelligenceController;

  beforeEach(async () => {
    const module = await Test.createTestingModule({
      controllers: [MarketIntelligenceController],
      providers: [
        { provide: MarketSyncService, useValue: { sync: jest.fn().mockResolvedValue(undefined) } },
        { provide: MarketAggregatorService, useValue: { getSnapshot: jest.fn(), listSnapshots: jest.fn() } },
        { provide: SymbolRegistryService, useValue: { list: jest.fn().mockResolvedValue([]) } },
        { provide: TimeframeRegistryService, useValue: { list: jest.fn().mockResolvedValue([]) } },
      ],
    }).compile();

    controller = module.get(MarketIntelligenceController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
