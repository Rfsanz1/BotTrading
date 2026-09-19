export function calculateDirectionalPnL(
  entryPrice: number,
  exitPrice: number,
  quantity: number,
  side: 'BUY' | 'SELL',
  fee = 0,
): number {
  const gross = side === 'BUY'
    ? (exitPrice - entryPrice) * quantity
    : (entryPrice - exitPrice) * quantity;
  return gross - fee;
}

export function getTradingDayKey(date: Date, timezone = 'UTC'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function calculateFillDelta(cumulativeQuantity: number, previouslyFilled: number): number {
  if (!Number.isFinite(cumulativeQuantity) || !Number.isFinite(previouslyFilled)) {
    throw new Error('Fill quantities must be finite');
  }
  const delta = cumulativeQuantity - previouslyFilled;
  if (delta < 0) {
    throw new Error('Cumulative fill quantity cannot move backwards');
  }
  return delta;
}
