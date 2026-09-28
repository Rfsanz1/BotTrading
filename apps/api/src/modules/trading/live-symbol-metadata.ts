import type { ExchangeSymbolInfo } from '@rfsanz/exchange';

export function validateLiveSymbolMetadata(
  registrySymbols: Array<{ symbol: string; baseAsset: string; quoteAsset: string }>,
  exchangeSymbols: ExchangeSymbolInfo[],
): { valid: boolean; reason: string } {
  if (registrySymbols.length === 0) return { valid: false, reason: 'No enabled Binance Spot USDT symbols are registered' };
  const exchangeBySymbol = new Map(exchangeSymbols.map((entry) => [entry.symbol, entry]));
  for (const registrySymbol of registrySymbols) {
    const info = exchangeBySymbol.get(registrySymbol.symbol);
    if (!info) return { valid: false, reason: `exchangeInfo missing ${registrySymbol.symbol}` };
    if (info.status !== 'TRADING'
      || info.baseAsset !== registrySymbol.baseAsset
      || info.quoteAsset !== registrySymbol.quoteAsset
      || info.isSpotTradingAllowed !== true) {
      return { valid: false, reason: `exchangeInfo trading permissions invalid for ${registrySymbol.symbol}` };
    }
    const filters = new Map(info.filters.map((filter) => [filter.filterType, filter]));
    const price = filters.get('PRICE_FILTER');
    const lot = filters.get('LOT_SIZE');
    const notional = filters.get('NOTIONAL') ?? filters.get('MIN_NOTIONAL');
    const maxNotional = notional?.maxNotional;
    if (!isPositive(price?.tickSize)
      || !isPositive(lot?.minQty)
      || !isPositive(lot?.maxQty)
      || !isPositive(lot?.stepSize)
      || Number(lot?.maxQty) <= Number(lot?.minQty)
      || !isPositive(notional?.minNotional)
      || !isPositive(maxNotional)
      || Number(maxNotional) < Number(notional?.minNotional)) {
      return { valid: false, reason: `exchangeInfo filters invalid for ${registrySymbol.symbol}` };
    }
    const requiredOrderTypes = ['LIMIT_MAKER', 'MARKET', 'STOP_LOSS_LIMIT', 'TAKE_PROFIT_LIMIT'];
    if (!requiredOrderTypes.every((type) => info.orderTypes?.includes(type))) {
      return { valid: false, reason: `exchangeInfo order types incomplete for ${registrySymbol.symbol}` };
    }
  }
  return { valid: true, reason: 'all registered symbols have valid exchange metadata' };
}

function isPositive(value: string | undefined): boolean {
  if (value === undefined || value.trim() === '') return false;
  const number = Number(value);
  return Number.isFinite(number) && number > 0;
}
