import { LocalOrderBookEngine } from '../services/local-order-book.engine';

describe('LocalOrderBookEngine', () => {
  it('initializes, applies updates, and removes zero quantity levels', () => {
    const book = new LocalOrderBookEngine();
    book.initialize({
      lastUpdateId: 10,
      bids: [[100, 2], [99, 3]],
      asks: [[101, 2], [102, 4]],
    });
    expect(book.applyUpdate({
      firstUpdateId: 11,
      finalUpdateId: 12,
      previousUpdateId: 10,
      eventTime: 1_000,
      bids: [[100, 0], [98, 5]],
      asks: [[101, 1]],
    })).toBe(true);
    const state = book.state(1_500);
    expect(state.bestBid).toBe(99);
    expect(state.bestAsk).toBe(101);
    expect(state.lastUpdateId).toBe(12);
    expect(state.sequenceHealthy).toBe(true);
    expect(state.dataAgeMs).toBe(500);
  });

  it('invalidates on sequence gaps and exposes stale state', () => {
    const book = new LocalOrderBookEngine();
    book.initialize({ lastUpdateId: 10, bids: [[100, 1]], asks: [[101, 1]] });
    expect(book.applyUpdate({
      firstUpdateId: 15,
      finalUpdateId: 15,
      previousUpdateId: 10,
      eventTime: 1_000,
      bids: [],
      asks: [],
    })).toBe(false);
    expect(book.state().sequenceHealthy).toBe(false);
    expect(book.state(40_000).dataAgeMs).toBeNull();
  });
});
