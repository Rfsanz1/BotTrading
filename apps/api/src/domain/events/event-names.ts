export const EVENT_NAMES = {
  orderValidationStarted: 'trading.order.validation_started',
  positionSizeCalculated: 'trading.position_size.calculated',
  orderSubmitted: 'trading.order.submitted_to_exchange',
  orderFilled: 'trading.order.filled',
  orderFailed: 'trading.order.failed',
  tradeRecorded: 'trading.trade.recorded',
  positionUpdated: 'trading.position.updated',
  positionClosed: 'trading.position.closed',
  balanceSynced: 'trading.balance.synced',
  balanceChanged: 'trading.balance.changed',
} as const;

export type CriticalEventName = typeof EVENT_NAMES[keyof typeof EVENT_NAMES];
