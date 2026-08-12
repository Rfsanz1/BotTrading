/**
 * Trading Safety Limits Configuration
 * Prevents catastrophic losses and manages risk
 */

export const TRADING_LIMITS = {
  // Maximum order value in USD
  MAX_ORDER_VALUE_USD: 500,

  // Daily loss limit - stop trading if reached
  DAILY_LOSS_LIMIT_USD: 1000,

  // Maximum position size as % of account
  MAX_POSITION_SIZE_PERCENT: 10,

  // Minimum balance to enable trading
  MIN_ACCOUNT_BALANCE_USD: 50,

  // Maximum concurrent positions
  MAX_CONCURRENT_POSITIONS: 5,

  // Cooldown period after stop-loss (minutes)
  COOLDOWN_AFTER_LOSS_MINUTES: 60,

  // Maximum leverage (for margin trading)
  MAX_LEVERAGE: 2,

  // Minimum order size
  MIN_ORDER_VALUE_USD: 10,

  // Risk percentage per trade
  MAX_RISK_PERCENT: 5, // Max 5% risk per trade
};

export const RATE_LIMITING = {
  // Binance rate limit threshold (%)
  THRESHOLD: 0.8,

  // Number of retry attempts
  RETRY_ATTEMPTS: 3,

  // Base retry delay (ms)
  RETRY_DELAY_MS: 1000,

  // Maximum retry delay (ms)
  MAX_RETRY_DELAY_MS: 10000,
};

export const MONITORING = {
  // Check health every N seconds
  HEALTH_CHECK_INTERVAL_SECONDS: 300,

  // Log important events
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',

  // Alert threshold for balance changes
  BALANCE_CHANGE_ALERT_PERCENT: 5,

  // Alert threshold for loss
  LOSS_ALERT_PERCENT: 10,
};
