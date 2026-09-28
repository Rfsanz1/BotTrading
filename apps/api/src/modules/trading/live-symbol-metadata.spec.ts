import type { ExchangeSymbolInfo } from '@rfsanz/exchange';
import { validateLiveSymbolMetadata } from './live-symbol-metadata';

const registered = [{ symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' }];
const validMetadata: ExchangeSymbolInfo[] = [{
  symbol: 'BTCUSDT',
  status: 'TRADING',
  baseAsset: 'BTC',
  quoteAsset: 'USDT',
  isSpotTradingAllowed: true,
  orderTypes: ['LIMIT_MAKER', 'MARKET', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT_LIMIT'],
  filters: [
    { filterType: 'PRICE_FILTER', tickSize: '0.01' },
    { filterType: 'LOT_SIZE', minQty: '0.00001', maxQty: '9000', stepSize: '0.00001' },
    { filterType: 'NOTIONAL', minNotional: '5', maxNotional: '9000000' },
  ],
}];

describe('LIVE symbol metadata validation', () => {
  it('requires current tradable Spot metadata and all required filters', () => {
    expect(validateLiveSymbolMetadata(registered, validMetadata)).toEqual({
      valid: true,
      reason: 'all registered symbols have valid exchange metadata',
    });
  });

  it('blocks metadata with missing bounds or OCO order types', () => {
    const missingMax = structuredClone(validMetadata);
    delete missingMax[0].filters[2].maxNotional;
    expect(validateLiveSymbolMetadata(registered, missingMax).valid).toBe(false);

    const missingProtectionType = structuredClone(validMetadata);
    missingProtectionType[0].orderTypes = ['LIMIT_MAKER', 'MARKET'];
    expect(validateLiveSymbolMetadata(registered, missingProtectionType).reason).toContain('order types incomplete');
  });

  it('blocks unregistered, delisted, or mismatched symbols', () => {
    expect(validateLiveSymbolMetadata([], validMetadata).valid).toBe(false);
    expect(validateLiveSymbolMetadata(registered, []).reason).toContain('missing BTCUSDT');

    const delisted = structuredClone(validMetadata);
    delisted[0].status = 'BREAK';
    expect(validateLiveSymbolMetadata(registered, delisted).reason).toContain('permissions invalid');
  });
});
