import pino, { Logger, LoggerOptions } from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

const baseOptions: LoggerOptions = {
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  base: {
    service: process.env.SERVICE_NAME ?? 'rfsanz',
    env: process.env.NODE_ENV ?? 'development',
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...(isDev && {
    transport: {
      target: 'pino-pretty',
      options: {
        colorize:        true,
        translateTime:   'HH:MM:ss.l',
        ignore:          'pid,hostname',
        singleLine:      false,
      },
    },
  }),
};

/** Root application logger. */
export const logger: Logger = pino(baseOptions);

/**
 * Create a child logger for a specific context (module, request, etc.).
 *
 * @example
 * const log = createLogger('AuthService');
 * log.info('User logged in', { userId });
 */
export function createLogger(context: string, extra?: Record<string, unknown>): Logger {
  return logger.child({ context, ...extra });
}

export type { Logger };
