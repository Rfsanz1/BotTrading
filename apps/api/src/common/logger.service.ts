import { Injectable, LoggerService } from '@nestjs/common';
import pino from 'pino';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

@Injectable()
export class PinoLogger implements LoggerService {
  log(message: any, ...optionalParams: any[]) {
    logger.info({ msg: message, meta: optionalParams });
  }
  error(message: any, trace?: string, context?: string) {
    logger.error({ msg: message, trace, context });
  }
  warn(message: any, ...optionalParams: any[]) {
    logger.warn({ msg: message, meta: optionalParams });
  }
  debug(message: any, ...optionalParams: any[]) {
    logger.debug({ msg: message, meta: optionalParams });
  }
  verbose(message: any, ...optionalParams: any[]) {
    logger.trace({ msg: message, meta: optionalParams });
  }
}

export default logger;
