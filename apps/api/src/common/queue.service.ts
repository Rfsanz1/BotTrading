import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';

const connection = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');

export function createQueue(name: string) {
  const queue = new Queue(name, { connection });
  return { queue };
}

export function createWorker(name: string, processor: any) {
  return new Worker(name, processor, { connection });
}

export default { createQueue, createWorker };
