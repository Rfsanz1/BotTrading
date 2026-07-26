import { RateLimiterRedis } from 'rate-limiter-flexible';
import { Request, Response, NextFunction } from 'express';
import { redis } from '../lib/redis';

const opts = {
  storeClient: redis,
  points: Number(process.env.RATE_LIMIT_POINTS || 100), // 100 requests
  duration: Number(process.env.RATE_LIMIT_DURATION || 60), // per 60 seconds
  keyPrefix: 'rlflx',
};

const rateLimiter = new RateLimiterRedis(opts as any);

export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const key = req.ip;
    await rateLimiter.consume(key, 1);
    next();
  } catch (rej) {
    res.set('Retry-After', String((rej as any).msBeforeNext / 1000 || 1));
    res.status(429).json({ error: 'Too many requests' });
  }
}

export default rateLimitMiddleware;
