import { BinanceMarketClient } from '../collectors/binance-market-client';
import { toBinanceSpotInterval } from '../collectors/binance-interval';

describe('BinanceMarketClient', () => {
  it.each([
    ['1M', '1m'],
    ['5M', '5m'],
    ['15M', '15m'],
    ['1H', '1h'],
    ['4H', '4h'],
    ['1D', '1d'],
  ])('maps internal timeframe %s to Binance interval %s', (timeframe, interval) => {
    expect(toBinanceSpotInterval(timeframe)).toBe(interval);
  });

  it('normalizes symbols and parses mocked Binance Spot klines', async () => {
    const fetcher = jest.fn().mockResolvedValue(new Response(JSON.stringify([
      [1, '100', '110', '90', '105', '12', 2, '1200', 4, '7', '700', '0'],
    ]), { status: 200, headers: { 'content-type': 'application/json' } }));
    const client = new BinanceMarketClient(fetcher);

    await expect(client.klines('BTC/USDT', '1H', 1)).resolves.toEqual([expect.objectContaining({
      openTime: 1,
      close: 105,
      volume: 12,
      closeTime: 2,
    })]);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=1'),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('rejects invalid timeframes before making a REST request', async () => {
    const fetcher = jest.fn();
    const client = new BinanceMarketClient(fetcher);
    await expect(client.klines('BTC/USDT', '2H', 1)).rejects.toThrow('Invalid internal timeframe: 2H');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('uses the futures kline endpoint while preserving the same explicit interval mapping', async () => {
    const fetcher = jest.fn().mockResolvedValue(new Response('[]', { status: 200 }));
    const client = new BinanceMarketClient(fetcher);

    await expect(client.klines('ETH/USDT', '4H', 2, true)).resolves.toEqual([]);
    expect(fetcher).toHaveBeenCalledWith(
      expect.stringContaining('/fapi/v1/klines?symbol=ETHUSDT&interval=4h&limit=2'),
      expect.anything(),
    );
  });

  it('includes safe Binance error details for non-success responses', async () => {
    const client = new BinanceMarketClient(jest.fn().mockResolvedValue(new Response(
      JSON.stringify({ code: -1121, msg: 'Invalid symbol.' }),
      { status: 400, headers: { 'content-type': 'application/json' } },
    )));
    await expect(client.klines('BTC/USDT', '1H')).rejects.toThrow(
      'status=400 endpoint=/api/v3/klines symbol=BTCUSDT interval=1h binanceCode=-1121 binanceMessage=Invalid symbol.',
    );
  });
});
