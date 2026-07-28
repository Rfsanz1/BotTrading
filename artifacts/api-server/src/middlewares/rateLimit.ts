import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { Request, Response, NextFunction } from 'express';
import { redis } from '../lib/redis';

const points = Number(process.env.RATE_LIMIT_POINTS || 100);
const duration = Number(process.env.RATE_LIMIT_DURATION || 60);

// Fall back to in-memory rate limiter when Redis is unavailable
let rateLimiter: RateLimiterRedis | RateLimiterMemory;

try {
  rateLimiter = new RateLimiterRedis({
    storeClient: redis,
    points,
    duration,
    keyPrefix: 'rlflx',
  } as any);
} catch {
  rateLimiter = new RateLimiterMemory({ points, duration, keyPrefix: 'rlflx' });
}

// Also swap to memory limiter if Redis emits a connection error
redis.on('error', () => {
  if (rateLimiter instanceof RateLimiterRedis) {
    rateLimiter = new RateLimiterMemory({ points, duration, keyPrefix: 'rlflx' });
  }
});

export async function rateLimitMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    const key = req.ip ?? 'unknown';
    await rateLimiter.consume(key, 1);
    next();
  } catch (rej) {
    res.set('Retry-After', String((rej as any).msBeforeNext / 1000 || 1));
    res.status(429).json({ error: 'Too many requests' });
  }
}

export default rateLimitMiddleware;
