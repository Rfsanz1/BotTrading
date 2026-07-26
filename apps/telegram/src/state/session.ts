import Redis from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const redis = new Redis(redisUrl);

export type SessionData = {
  chatId: number;
  page?: string;
  payload?: Record<string, any>;
};

export async function getSession(chatId: number): Promise<SessionData | null> {
  const raw = await redis.get(`tg:session:${chatId}`);
  if (!raw) return null;
  try { return JSON.parse(raw) as SessionData; } catch (e) { return null; }
}

export async function setSession(chatId: number, data: SessionData) {
  await redis.set(`tg:session:${chatId}`, JSON.stringify(data), 'EX', 60 * 60 * 24);
}

export async function clearSession(chatId: number) {
  await redis.del(`tg:session:${chatId}`);
}

export default redis;
