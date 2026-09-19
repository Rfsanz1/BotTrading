import { calculateDirectionalPnL, calculateFillDelta, getTradingDayKey } from '../services/pnl';

describe('directional accounting', () => {
  it.each([
    ['BUY', 100, 110, 2, 20],
    ['SELL', 100, 90, 2, 20],
    ['BUY', 100, 90, 2, -20],
    ['SELL', 100, 110, 2, -20],
  ] as const)('%s P&L is directional', (side, entry, exit, quantity, expected) => {
    expect(calculateDirectionalPnL(entry, exit, quantity, side)).toBe(expected);
  });

  it('subtracts fees once from realized P&L', () => {
    expect(calculateDirectionalPnL(100, 110, 2, 'BUY', 1.5)).toBe(18.5);
  });

  it('uses explicit timezone trading-day boundaries', () => {
    const instant = new Date('2026-09-13T00:30:00.000Z');
    expect(getTradingDayKey(instant, 'UTC')).toBe('2026-09-13');
    expect(getTradingDayKey(instant, 'America/Los_Angeles')).toBe('2026-09-12');
  });

  it('accounts for cumulative fills as deltas and rejects regressions', () => {
    expect(calculateFillDelta(0.75, 0.5)).toBe(0.25);
    expect(calculateFillDelta(0.75, 0.75)).toBe(0);
    expect(() => calculateFillDelta(0.5, 0.75)).toThrow('cannot move backwards');
  });
});
