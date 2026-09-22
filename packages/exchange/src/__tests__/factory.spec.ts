import { listSupported } from '../factory';

describe('exchange factory', () => {
  it('should list supported exchanges', () => {
    const list = listSupported();
    expect(list).toEqual(['binance', 'paper']);
  });
});
