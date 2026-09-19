import { z } from 'zod';

export const EnvSchema = z.object({
  PORT: z.string().optional(),
  DATABASE_URL: z.string().url(),
  REDIS_URL: z.string().url().optional(),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  TRADING_MODE: z.enum(['PAPER', 'TESTNET', 'LIVE']).default('PAPER'),
  TESTNET_EXCHANGE_ACCOUNT_ID: z.string().uuid().optional(),
  LIVE_EXCHANGE_ACCOUNT_ID: z.string().uuid().optional(),
  LIVE_TRADING_ENABLED: z.enum(['true', 'false']).default('false'),
  RISK_CONFIG_VERSION: z.string().min(1).optional(),
  TRADING_MIN_ACCOUNT_BALANCE_USD: z.string().optional(),
  TRADING_MAX_ORDER_VALUE_USD: z.string().optional(),
  TRADING_DAILY_LOSS_LIMIT_USD: z.string().optional(),
  TRADING_MAX_POSITION_SIZE_PERCENT: z.string().optional(),
  TRADING_MAX_CONCURRENT_POSITIONS: z.string().optional(),
  EXCHANGE_CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
  BINANCE_TESTNET_API_KEY: z.string().optional(),
  BINANCE_TESTNET_API_SECRET: z.string().optional(),
  BINANCE_LIVE_API_KEY: z.string().optional(),
  BINANCE_LIVE_API_SECRET: z.string().optional(),
  WEBHOOK_HMAC_SECRET: z.string().min(32).optional(),
  WEBHOOK_USER_ID: z.string().uuid().optional(),
  ENABLE_SWAGGER: z.enum(['true', 'false']).default('false'),
}).superRefine((env, ctx) => {
  if (env.TRADING_MODE !== 'PAPER' && !env.EXCHANGE_CREDENTIAL_ENCRYPTION_KEY) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['EXCHANGE_CREDENTIAL_ENCRYPTION_KEY'],
      message: 'Required outside PAPER mode',
    });
  }
  if (env.TRADING_MODE === 'TESTNET' && !env.TESTNET_EXCHANGE_ACCOUNT_ID) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['TESTNET_EXCHANGE_ACCOUNT_ID'],
      message: 'Required for TESTNET mode',
    });
  }
  if (env.TRADING_MODE === 'LIVE' && env.LIVE_TRADING_ENABLED !== 'true') {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['LIVE_TRADING_ENABLED'],
      message: 'LIVE mode requires explicit LIVE_TRADING_ENABLED=true',
    });
  }
  if (env.TRADING_MODE === 'LIVE') {
    const required = [
      'LIVE_EXCHANGE_ACCOUNT_ID',
      'RISK_CONFIG_VERSION',
      'TRADING_MIN_ACCOUNT_BALANCE_USD',
      'TRADING_MAX_ORDER_VALUE_USD',
      'TRADING_DAILY_LOSS_LIMIT_USD',
      'TRADING_MAX_POSITION_SIZE_PERCENT',
      'TRADING_MAX_CONCURRENT_POSITIONS',
    ] as const;
    for (const name of required) {
      if (!env[name]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message: 'Required for LIVE mode',
        });
      }
    }

    const numeric = (name: string, value: string | undefined): number | undefined => {
      if (value === undefined) return undefined;
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [name],
          message: 'Must be a finite number',
        });
        return undefined;
      }
      return parsed;
    };
    const minBalance = numeric('TRADING_MIN_ACCOUNT_BALANCE_USD', env.TRADING_MIN_ACCOUNT_BALANCE_USD);
    const maxOrder = numeric('TRADING_MAX_ORDER_VALUE_USD', env.TRADING_MAX_ORDER_VALUE_USD);
    const dailyLoss = numeric('TRADING_DAILY_LOSS_LIMIT_USD', env.TRADING_DAILY_LOSS_LIMIT_USD);
    const maxPosition = numeric('TRADING_MAX_POSITION_SIZE_PERCENT', env.TRADING_MAX_POSITION_SIZE_PERCENT);
    const maxConcurrent = numeric('TRADING_MAX_CONCURRENT_POSITIONS', env.TRADING_MAX_CONCURRENT_POSITIONS);
    if (minBalance !== undefined && minBalance <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TRADING_MIN_ACCOUNT_BALANCE_USD'], message: 'Must be positive' });
    if (maxOrder !== undefined && maxOrder <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TRADING_MAX_ORDER_VALUE_USD'], message: 'Must be positive' });
    if (dailyLoss !== undefined && dailyLoss <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TRADING_DAILY_LOSS_LIMIT_USD'], message: 'Must be positive' });
    if (maxPosition !== undefined && (maxPosition <= 0 || maxPosition > 100)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TRADING_MAX_POSITION_SIZE_PERCENT'], message: 'Must be greater than 0 and at most 100' });
    if (maxConcurrent !== undefined && (!Number.isInteger(maxConcurrent) || maxConcurrent <= 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TRADING_MAX_CONCURRENT_POSITIONS'], message: 'Must be a positive integer' });
    if (maxOrder !== undefined && minBalance !== undefined && maxOrder < minBalance) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['TRADING_MAX_ORDER_VALUE_USD'], message: 'Must not be below minimum account balance' });
    }
  }
});

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(env: NodeJS.ProcessEnv): Env {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) throw new Error('Invalid environment: ' + JSON.stringify(parsed.error.format()));
  return parsed.data;
}
