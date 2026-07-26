import pino from 'pino';

export const logger = pino({ name: 'rfsanz-telegram', level: process.env.LOG_LEVEL || 'info' });

export class BaseService {
  protected log = logger;
}

export default BaseService;
