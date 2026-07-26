import Redis from 'ioredis';
import { z } from 'zod';

const envSchema = z.object({ REDIS_URL: z.string().url().optional() });
const env = envSchema.parse(process.env);

const redisUrl = env.REDIS_URL || 'redis://localhost:6379';

export const redis = new Redis(redisUrl);

redis.on('error', (err) => {
  console.error('Redis error', err);
});

export default redis;
