import { describe, it, expect } from 'vitest';
import { listSupported } from '../factory';

describe('exchange factory', () => {
  it('should list supported exchanges', () => {
    const list = listSupported();
    expect(list).toEqual(expect.arrayContaining(['binance','bybit','okx','mexc','mt5']));
  });
});
