import { BinanceMarketClient } from '../collectors/binance-market-client';
import { SymbolRegistryService } from '../services/symbol-registry.service';

const symbol = (overrides: Record<string, unknown> = {}) => ({
  symbol: 'BTCUSDT',
  status: 'TRADING',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  isSpotTradingAllowed: true,
  filters: [{ filterType: 'PRICE_FILTER' }],
  ...overrides,
});

const realBinanceSpotSymbol = (overrides: Record<string, unknown> = {}) => symbol({
  permissions: [],
  permissionSets: [['SPOT', 'MARGIN', 'TRD_GRP_1']],
  ...overrides,
});

function clientWith(payload: unknown) {
  return { spotExchangeInfo: jest.fn().mockResolvedValue(payload) } as unknown as BinanceMarketClient;
}

describe('SymbolRegistryService', () => {
  it('parses and filters the Binance Spot exchangeInfo universe', async () => {
    const client = clientWith({
      symbols: [
        realBinanceSpotSymbol(),
        realBinanceSpotSymbol({ symbol: 'eth/usdt', baseAsset: 'ETH' }),
        symbol({ symbol: 'ADAUSDT', status: 'BREAK' }),
        symbol({ symbol: 'SOLBTC', baseAsset: 'SOL', quoteAsset: 'BTC' }),
        symbol({ symbol: 'XRPUSDT', isSpotTradingAllowed: false }),
        symbol({ symbol: 'BNBUSDT', permissions: ['MARGIN'] }),
        symbol({ symbol: 'DOGEUSDT', filters: undefined }),
      ],
    });
    const registry = new SymbolRegistryService(client);

    await expect(registry.syncSpotSymbolsFromBinance()).resolves.toMatchObject({
      status: 'HEALTHY',
      symbolCount: 2,
      enabledCount: 2,
      spotUsdtCount: 2,
      spotCount: 2,
      futuresCount: 0,
    });
    await expect(registry.list()).resolves.toEqual(expect.arrayContaining([
      expect.objectContaining({ symbol: 'BTCUSDT', quoteAsset: 'USDT', marketType: 'spot' }),
      expect.objectContaining({ symbol: 'ETHUSDT', quoteAsset: 'USDT', marketType: 'spot' }),
    ]));
  });

  it('accepts the current Binance payload with empty permissions and nested permissionSets', async () => {
    const registry = new SymbolRegistryService(clientWith({
      symbols: [realBinanceSpotSymbol()],
    }));

    await expect(registry.syncSpotSymbolsFromBinance()).resolves.toMatchObject({
      status: 'HEALTHY',
      symbolCount: 1,
      spotUsdtCount: 1,
    });
  });

  it('supports direct permissions and rejects explicit non-Spot permissions', async () => {
    const registry = new SymbolRegistryService(clientWith({
      symbols: [
        symbol({ symbol: 'ETHUSDT', baseAsset: 'ETH', permissions: ['SPOT'] }),
        symbol({ symbol: 'BNBUSDT', baseAsset: 'BNB', permissions: ['MARGIN'] }),
        symbol({ symbol: 'SOLUSDT', baseAsset: 'SOL', permissions: [], permissionSets: [['MARGIN']] }),
      ],
    }));

    await registry.syncSpotSymbolsFromBinance();
    expect((await registry.list()).map((entry) => entry.symbol)).toEqual(['ETHUSDT']);
  });

  it('rejects symbols that fail the primary Spot, quote, or trading filters', async () => {
    const registry = new SymbolRegistryService(clientWith({
      symbols: [
        realBinanceSpotSymbol({ symbol: 'ETHUSDT', baseAsset: 'ETH', isSpotTradingAllowed: false }),
        realBinanceSpotSymbol({ symbol: 'SOLBTC', baseAsset: 'SOL', quoteAsset: 'BTC' }),
        realBinanceSpotSymbol({ symbol: 'BNBUSDT', baseAsset: 'BNB', status: 'BREAK' }),
      ],
    }));

    await expect(registry.syncSpotSymbolsFromBinance()).resolves.toMatchObject({
      status: 'INVALID',
      symbolCount: 0,
    });
  });

  it('deduplicates normalized exchangeInfo symbols and repeated refreshes', async () => {
    const client = clientWith({ symbols: [symbol({ symbol: 'btcusdt' }), symbol({ symbol: 'BTC/USDT' })] });
    const registry = new SymbolRegistryService(client);

    await registry.syncSpotSymbolsFromBinance();
    await registry.syncSpotSymbolsFromBinance();

    expect((await registry.list()).map((entry) => entry.symbol)).toEqual(['BTCUSDT']);
    expect(client.spotExchangeInfo).toHaveBeenCalledTimes(2);
  });

  it('preserves the last-known-good registry when refresh fails', async () => {
    const client = clientWith({ symbols: [symbol()] });
    const registry = new SymbolRegistryService(client);
    await registry.syncSpotSymbolsFromBinance();
    (client.spotExchangeInfo as jest.Mock).mockRejectedValueOnce(new Error('network unavailable'));

    await expect(registry.syncSpotSymbolsFromBinance()).resolves.toMatchObject({
      status: 'DEGRADED',
      symbolCount: 1,
      enabledCount: 1,
      error: 'network unavailable',
    });
    expect((await registry.list())[0].symbol).toBe('BTCUSDT');
  });

  it('reports an unavailable initial registry and protects against overlapping refreshes', async () => {
    let release!: (value: unknown) => void;
    const pending = new Promise((resolve) => { release = resolve; });
    const client = { spotExchangeInfo: jest.fn().mockReturnValue(pending) } as unknown as BinanceMarketClient;
    const registry = new SymbolRegistryService(client);

    const first = registry.syncSpotSymbolsFromBinance();
    const second = await registry.syncSpotSymbolsFromBinance();
    expect(second.status).toBe('INVALID');
    expect(client.spotExchangeInfo).toHaveBeenCalledTimes(1);

    release({ symbols: [symbol()] });
    await first;
    expect(registry.health().status).toBe('HEALTHY');
  });

  it('reports an invalid empty initial registry without pretending it is healthy', async () => {
    const registry = new SymbolRegistryService(clientWith({ symbols: [] }));

    await expect(registry.syncSpotSymbolsFromBinance()).resolves.toMatchObject({
      status: 'INVALID',
      symbolCount: 0,
      spotUsdtCount: 0,
    });
    expect(await registry.list()).toEqual([]);
  });

  it('hydrates automatically on module startup', async () => {
    const client = clientWith({ symbols: [symbol({ symbol: 'ETHUSDT', baseAsset: 'ETH' })] });
    const registry = new SymbolRegistryService(client);

    await registry.onModuleInit();

    expect((await registry.list()).map((entry) => entry.symbol)).toEqual(['ETHUSDT']);
  });
});
