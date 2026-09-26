import { BinanceMarketClient } from '../collectors/binance-market-client';
import { FuturesIntelligenceService } from '../services/futures-intelligence.service';

describe('futures historical intelligence', () => {
  it('parses funding and OI history from Binance payload fields', async () => {
    const fetcher = jest.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify([{ fundingRate: '0.001', fundingTime: 10 }]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify([{ sumOpenInterest: '123.4', timestamp: 20 }]), { status: 200 }));
    const client = new BinanceMarketClient(fetcher);
    await expect(client.fundingHistory('BTCUSDT', 1)).resolves.toEqual([{ fundingRate: 0.001, fundingTime: 10 }]);
    await expect(client.openInterestHistory('BTCUSDT', '5m', 1)).resolves.toEqual([{ openInterest: 123.4, timestamp: 20 }]);
  });

  it('returns explicit rolling funding and OI features', () => {
    const service = new FuturesIntelligenceService();
    expect(service.fundingFeatures([0.001, 0.002], 0.003).delta).toBeCloseTo(0.001);
    expect(service.openInterestFeatures([100, 110], 120).trend).toBe('INCREASING');
  });
});
