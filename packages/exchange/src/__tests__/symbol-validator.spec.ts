import {
  normalizeDecimalToStep,
  normalizePriceForSide,
  SymbolValidator,
} from '../services/symbol-validator.service';

describe('symbol price normalization', () => {
  it('normalizes BTCUSDT tickSize without binary floating point artifacts', () => {
    expect(normalizeDecimalToStep('77695.07000000001', '0.01', 'floor')).toBe('77695.07');
    expect(normalizeDecimalToStep('77695.07', '0.01', 'floor')).toBe('77695.07');
    expect(normalizeDecimalToStep('77695.071', '0.01', 'floor')).toBe('77695.07');
  });

  it('uses conservative directional rounding for entry prices', () => {
    expect(normalizePriceForSide('100.001', '0.01', 'BUY')).toBe('100');
    expect(normalizePriceForSide('100.001', '0.01', 'SELL')).toBe('100.01');
  });

  it('handles very small tick sizes and exact ticks', () => {
    expect(normalizeDecimalToStep('0.000000123456', '0.00000001', 'floor')).toBe('0.00000012');
    expect(normalizeDecimalToStep('0.00000012', '0.00000001', 'nearest')).toBe('0.00000012');
  });

  it('preserves protective stop and target directions', () => {
    const validator = new SymbolValidator();
    const info = {
      symbol: 'BTCUSDT',
      status: 'TRADING',
      filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.01', minPrice: '0.01', maxPrice: '1000000' }],
    };
    expect(validator.normalizeProtectionPrice(99.999, info, 'BUY', 'stop')).toBe(99.99);
    expect(validator.normalizeProtectionPrice(100.001, info, 'BUY', 'target')).toBe(100.01);
    expect(validator.normalizeProtectionPrice(100.001, info, 'SELL', 'stop')).toBe(100.01);
    expect(validator.normalizeProtectionPrice(99.999, info, 'SELL', 'target')).toBe(99.99);
  });
});
